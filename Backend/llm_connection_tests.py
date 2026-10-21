"""Provider recovery without replaying chat writes or exposing provider internals."""
import unittest
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
import httpx
from groq import APIConnectionError, AuthenticationError
from app.ai import llm as module


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        # Mock this module's clock, not Python's shared time module (Mongo has worker threads).
        self.clock = SimpleNamespace(time=time.time, monotonic=time.monotonic, sleep=Mock())
        self.clock_patch = patch.object(module, 'time', self.clock)
        self.clock_patch.start()
        self.addCleanup(self.clock_patch.stop)
        self.coordinator = module.GroqTokenCoordinator('test', 1000)
        self.patcher = patch.object(module, 'coordinator', self.coordinator)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.request = httpx.Request('POST', 'https://api.groq.com/openai/v1/chat/completions')

    def failure(self):
        return APIConnectionError(request=self.request)

    def test_transient_connection_recovers_using_one_reservation(self):
        response = SimpleNamespace(content='OK', usage_metadata={'output_tokens': 2})
        client = Mock(); client.invoke.side_effect = [self.failure(), response]
        with patch.object(module, 'ChatGroq', return_value=client) as factory, patch.object(module.time, 'sleep') as sleep:
            self.assertIs(module.RateAwareLLM('test').invoke('hello', agent_name='connection_test', max_tokens=16, min_tokens=1), response)
        self.assertEqual(client.invoke.call_count, 2)
        self.assertEqual(self.coordinator.get_used_tokens(), 2)
        self.assertEqual(len(self.coordinator.token_history), 1)
        sleep.assert_called_once_with(0.5)
        self.assertLessEqual(factory.call_args.kwargs['request_timeout'], 20)

    def test_persistent_failure_stops_and_releases_budget_and_semaphore(self):
        client = Mock(); client.invoke.side_effect = self.failure()
        with patch.object(module, 'ChatGroq', return_value=client), patch.object(module.time, 'sleep'):
            with self.assertRaises(APIConnectionError):
                module.RateAwareLLM('test').invoke('hello', agent_name='connection_test', max_tokens=16, min_tokens=1)
        self.assertEqual(client.invoke.call_count, 2)
        self.assertEqual(self.coordinator.get_used_tokens(), 0)
        self.assertTrue(self.coordinator.concurrency_semaphore.acquire(blocking=False))
        self.coordinator.concurrency_semaphore.release()

    def test_no_retry_when_disabled_or_deadline_exhausted(self):
        for retries, clock in [(0, [0, 0]), (1, [0, 0, 20])]:
            client = Mock(); client.invoke.side_effect = self.failure()
            with patch.object(module, 'ChatGroq', return_value=client), patch.object(module.time, 'sleep') as sleep, patch.object(module.time, 'monotonic', side_effect=clock):
                with self.assertRaises(APIConnectionError):
                    module.RateAwareLLM('test').invoke('hello', agent_name='connection_test', max_tokens=16, min_tokens=1, max_retries=retries)
            self.assertEqual(client.invoke.call_count, 1)
            sleep.assert_not_called()

    def test_invalid_credentials_are_not_retried(self):
        error = AuthenticationError('sensitive provider details', response=httpx.Response(401, request=self.request), body=None)
        client = Mock(); client.invoke.side_effect = error
        with patch.object(module, 'ChatGroq', return_value=client), patch.object(module.time, 'sleep') as sleep:
            with self.assertRaises(AuthenticationError):
                module.RateAwareLLM('test').invoke('hello', agent_name='connection_test', max_tokens=16, min_tokens=1)
        self.assertEqual(client.invoke.call_count, 1)
        sleep.assert_not_called()
        self.assertNotIn('sensitive', module.public_llm_error(error))
        self.assertIn('credentials', module.public_llm_error(error))

    def test_failed_chat_analysis_preserves_context_without_planning(self):
        from app.services import chat_service
        context = {'destination': 'Kerala', 'days': 3}
        conversation = SimpleNamespace(conversation_id='connection-test', current_trip_id=None,
            travel_context=SimpleNamespace(model_dump=lambda: context))
        with patch.object(chat_service, 'get_or_create_conversation', return_value=conversation), patch.object(chat_service, 'get_conversation_messages', return_value=[]), patch.object(chat_service, 'add_message') as save, patch.object(chat_service, 'analyze_user_message', side_effect=self.failure()), patch.object(chat_service.graph, 'invoke') as planning, patch.object(chat_service, 'update_travel_context') as update:
            result = chat_service.process_chat_message(None, 'plan the trip', 'test-user')
        self.assertEqual(result['intent'], 'ERROR')
        self.assertEqual(result['travel_context'], context)
        self.assertIn("couldn't connect", result['message']['content'])
        self.assertNotIn('configuration', result['message']['content'])
        self.assertEqual(save.call_count, 2)
        planning.assert_not_called(); update.assert_not_called()


if __name__ == '__main__':
    unittest.main()
