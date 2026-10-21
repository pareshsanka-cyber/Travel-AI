import test from 'node:test';
import assert from 'node:assert/strict';
import { authRequest, AuthHttpError } from '../src/services/authTransport';

Object.assign(globalThis, { localStorage: { getItem: () => null } });

test('session verification retains HTTP status so outages cannot be confused with expiry', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 500, 503]) {
      globalThis.fetch = async (_url, options) => {
        assert.equal(options?.method, 'GET');
        assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer saved-session');
        return new Response(JSON.stringify({ detail: 'Session check failed' }), { status });
      };
      await assert.rejects(authRequest('me', undefined, 'saved-session'), (error: unknown) => error instanceof AuthHttpError && error.status === status);
    }
  } finally { globalThis.fetch = original; }
});

test('unreadable authentication errors preserve status without rendering server markup', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>private server error</html>', { status: 503 });
  try { await assert.rejects(authRequest('me'), (error: unknown) => error instanceof AuthHttpError && error.status === 503 && !error.message.includes('private')); }
  finally { globalThis.fetch = original; }
});
