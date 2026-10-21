import test from 'node:test';
import assert from 'node:assert/strict';
import { planningSteps } from '../src/services/planningProgressModel';
import type { PlanningProgress } from '../src/services/planningProgress';
import { ProgressUnavailable, trackPlanning, readPendingPlanning, savePendingPlanning } from '../src/services/planningProgress';
import type { PendingPlanningRequest } from '../src/services/planningProgress';

const local = new Map<string, string>([['travelai_user', JSON.stringify({ id: 'owner' })], ['TRAVELAI_FASTAPI_URL', 'http://localhost:8000']]);
const session = new Map<string, string>();
const storage = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
Object.assign(globalThis, { localStorage: storage(local), sessionStorage: storage(session), window: { dispatchEvent: () => true } });
const request: PendingPlanningRequest = { id: 'request-1234567890', owner: 'owner', endpoint: 'http://localhost:8000', conversationId: 'c', text: 'Plan Goa', prompt: 'Plan Goa with saved context', context: { destination: 'Goa', travelers: 2 } };
const response = { conversation_id: 'c', intent: 'GENERAL_CHAT', message: { role: 'assistant', content: 'Recovered response' }, travel_context: {}, data: null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const base: PlanningProgress = { request_id: 'request', status: 'running', kind: 'planning', stages: {} };
test('parallel discovery stays in progress until all real checks finish', () => {
  const progress = { ...base, stages: { flights: { status: 'done' as const }, hotels: { status: 'running' as const } } };
  assert.equal(planningSteps(progress).find(step => step.id === 'discovery')?.status, 'running');
  assert.equal(planningSteps(progress).find(step => step.id === 'saving')?.status, 'waiting');
});
test('unavailable results remain warnings instead of successful verification', () => {
  const stages = Object.fromEntries(['attractions', 'restaurants', 'flights', 'hotels', 'weather'].map(stage => [stage, { status: stage === 'weather' ? 'warning' as const : 'done' as const }]));
  assert.equal(planningSteps({ ...base, stages }).find(step => step.id === 'discovery')?.status, 'warning');
});
test('validation failure remains visible and synthesis alone never means saved', () => {
  const stages = { reviewer: { status: 'failed' as const }, synthesis: { status: 'done' as const } };
  assert.equal(planningSteps({ ...base, stages }).find(step => step.id === 'validation')?.status, 'failed');
  assert.equal(planningSteps({ ...base, stages }).find(step => step.id === 'saving')?.status, 'running');
});

test('a failed server response remains recoverable instead of being treated as success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ ...base, request_id: request.id, status: 'failed', result: response, recovery: { retryable: true }, error: 'Provider unavailable' });
  try { await assert.rejects(trackPlanning(request, () => {}, new AbortController().signal, true), (error: unknown) => error instanceof ProgressUnavailable && error.progress.recovery?.retryable === true && error.message === 'Provider unavailable'); }
  finally { globalThis.fetch = original; }
});

test('retry checks the request first and submits only its stable attempt reference', async () => {
  const original = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('/retry')) {
      assert.deepEqual(JSON.parse(String(options?.body)), { attempt_id: 'retry-attempt-123456' });
      return json({ ...base, request_id: request.id, status: 'succeeded', result: response, retry_attempt_id: 'retry-attempt-123456' });
    }
    assert.equal(options?.method, 'GET');
    return json({ ...base, request_id: request.id, status: 'failed', recovery: { retryable: true } });
  };
  try {
    const result = await trackPlanning({ ...request, observedServer: true, retryAttemptId: 'retry-attempt-123456' }, () => {}, new AbortController().signal, true);
    assert.equal(result.replyMessage.text, 'Recovered response'); assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test('refresh after an attempted retry cannot replay a failed retry', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++; assert.equal(options?.method, 'GET');
    return json({ ...base, request_id: request.id, status: 'failed', recovery: { retryable: true }, retry_attempt_id: 'retry-attempt-123456' });
  };
  try { await assert.rejects(trackPlanning({ ...request, observedServer: true, retryAttemptId: 'retry-attempt-123456' }, () => {}, new AbortController().signal, true), ProgressUnavailable); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('a previously observed missing request never silently starts another plan', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; assert.equal(options?.method, 'GET'); return json({ detail: 'Not found' }, 404); };
  try { await assert.rejects(trackPlanning({ ...request, observedServer: true }, () => {}, new AbortController().signal, true), (error: unknown) => error instanceof ProgressUnavailable && error.progress.status === 'interrupted'); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('an uncertain initial submission is recovered with a GET and no second POST', async () => {
  const original = globalThis.fetch; const methods: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    methods.push(options?.method);
    if (options?.method === 'POST') throw new TypeError('Lost acknowledgement');
    return json({ ...base, request_id: request.id, status: 'succeeded', result: response });
  };
  try { await trackPlanning(request, () => {}, new AbortController().signal); assert.deepEqual(methods, ['POST', 'GET']); }
  finally { globalThis.fetch = original; }
});

test('saved recovery details remain isolated to the signed-in owner', () => {
  savePendingPlanning(request); assert.deepEqual(readPendingPlanning(), request);
  local.set('travelai_user', JSON.stringify({ id: 'another-owner' }));
  assert.equal(readPendingPlanning(), null);
  local.set('travelai_user', JSON.stringify({ id: 'owner' }));
  assert.deepEqual(readPendingPlanning(), request);
});

test('a successful request with an unreadable response pauses for recovery instead of spinning forever', async () => {
  const original = globalThis.fetch;
  try {
    for (const result of [null, { conversation_id: 'c', message: {} }]) {
      globalThis.fetch = async () => json({ ...base, request_id: request.id, status: 'succeeded', result });
      await assert.rejects(trackPlanning(request, () => {}, new AbortController().signal, true), (error: unknown) => error instanceof ProgressUnavailable && error.progress.status === 'connection_lost');
    }
  } finally { globalThis.fetch = original; }
});
