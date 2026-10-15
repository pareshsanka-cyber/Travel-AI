import test from 'node:test';
import assert from 'node:assert/strict';
import { appendedMessageIds } from '../src/motion/tokens';

test('a live request animates only its newly appended message IDs', () => {
  assert.deepEqual(appendedMessageIds(['welcome', 'user'], ['welcome', 'user', 'reply'], true), ['reply']);
  assert.deepEqual(appendedMessageIds(['welcome'], ['welcome', 'user', 'reply'], true), ['user', 'reply']);
});

test('restored history, replaced conversations and initial messages do not animate', () => {
  assert.deepEqual(appendedMessageIds(['welcome'], ['welcome', 'restored'], false), []);
  assert.deepEqual(appendedMessageIds(['goa'], ['sydney', 'reply'], true), []);
  assert.deepEqual(appendedMessageIds([], ['restored'], true), []);
});

test('unchanged, trimmed and reordered history cannot replay a message entrance', () => {
  assert.deepEqual(appendedMessageIds(['user', 'reply'], ['user', 'reply'], true), []);
  assert.deepEqual(appendedMessageIds(['user', 'reply'], ['reply'], true), []);
  assert.deepEqual(appendedMessageIds(['user', 'reply'], ['reply', 'user', 'next'], true), []);
});
