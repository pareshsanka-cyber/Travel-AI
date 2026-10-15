"""Owned trip editing sessions: reuse, isolation, legacy trips and duplicate clicks."""
import copy
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError
from app.main import app
from app.api import trips
from app.utils import auth_utils
from security_consistency_tests import Collection, sample_trip


class EditSessionTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(ObjectId())
        trip = sample_trip(); trip.update(user_id=self.owner, destination='Sydney, Australia', travelers=7)
        self.trip_id = str(trip['_id'])
        self.db = SimpleNamespace(users=Collection([{'_id': ObjectId(self.owner)}]), sessions=Collection(),
            trips=Collection([trip]), conversations=Collection())
        for module in (trips, auth_utils):
            patcher = patch.object(module, 'db', self.db); patcher.start(); self.addCleanup(patcher.stop)
        self.headers = {'Authorization': 'Bearer ' + auth_utils.generate_token('test@example.com', self.owner)}
        self.client = TestClient(app)

    def open(self, identity=None, headers=None):
        return self.client.post('/api/trips/' + (identity or self.trip_id) + '/edit-session', headers=self.headers if headers is None else headers)

    def test_creates_linked_legacy_session_without_trip_changes(self):
        before = copy.deepcopy(self.db.trips.docs)
        self.assertEqual(self.open().status_code, 200)
        document = self.db.conversations.docs[0]
        self.assertEqual(document['travel_context']['destination'], 'Sydney, Australia')
        self.assertEqual(document['travel_context']['travelers'], 7)
        self.assertEqual(document['current_trip_id'], self.trip_id)
        self.assertEqual(self.db.trips.docs, before)

    def test_repeated_requests_reuse_session(self):
        first = self.open().json()
        self.assertEqual(self.open().json(), first)
        self.assertEqual(len(self.db.conversations.docs), 1)

    def test_reuses_owned_matching_conversation(self):
        self.db.conversations.insert_one({'conversation_id': 'existing', 'user_id': self.owner,
            'current_trip_id': self.trip_id, 'status': 'active', 'travel_context': {'destination': 'Sydney, Australia'}, 'updated_at': datetime.utcnow()})
        self.assertEqual(self.open().json()['conversation_id'], 'existing')

    def test_goa_context_and_other_owners_are_not_reused_for_sydney(self):
        self.db.conversations.insert_one({'conversation_id': 'goa', 'user_id': self.owner, 'current_trip_id': self.trip_id,
            'status': 'active', 'travel_context': {'destination': 'Goa'}, 'updated_at': datetime.utcnow()})
        self.db.conversations.insert_one({'conversation_id': 'other', 'user_id': 'other-owner', 'current_trip_id': self.trip_id,
            'status': 'active', 'travel_context': {'destination': 'Sydney, Australia'}, 'updated_at': datetime.utcnow()})
        self.assertNotIn(self.open().json()['conversation_id'], ['goa', 'other'])

    def test_authentication_and_trip_ownership(self):
        self.assertEqual(self.open(headers={}).status_code, 401)
        self.assertEqual(self.open(str(ObjectId())).status_code, 404)
        self.db.trips.docs[0]['user_id'] = 'other-owner'
        self.assertEqual(self.open().status_code, 404)

    def test_duplicate_insert_recovers_owned_session(self):
        original = self.db.conversations.insert_one
        def race(document):
            original(document)
            raise DuplicateKeyError('concurrent request')
        with patch.object(self.db.conversations, 'insert_one', race):
            self.assertEqual(self.open().status_code, 200)
        self.assertEqual(len(self.db.conversations.docs), 1)


if __name__ == '__main__': unittest.main()
