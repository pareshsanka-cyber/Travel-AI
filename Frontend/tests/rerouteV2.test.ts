import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAdjustment, normalizeReviewStop, previewAdjustment, fetchDayDirections, type ReviewProposal } from '../src/services/rerouteV2';

Object.assign(globalThis, { window: { dispatchEvent: () => true }, localStorage: { getItem: () => null } });

test('review snapshots normalize saved times and stable identifiers', () => {
  const stop = normalizeReviewStop({ id: 'stable', name: 'Gallery', start_time: '10:30', end_time: '11:30', lat: 1, lon: 2, timezone: 'Europe/London' });
  assert.equal(stop.id, 'stable'); assert.equal(stop.title, 'Gallery'); assert.equal(stop.startTime, '10:30'); assert.equal(stop.timezone, 'Europe/London');
});

test('confirmation sends only version, proposal, option and revision', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      assert.match(String(url), /trip%2Fid\/reroute\/apply$/);
      assert.deepEqual(JSON.parse(String(options?.body)), { version: 2, proposal_id: 'p', option_id: 'chosen', expected_revision: 4 });
      return new Response('{"status":"success"}');
    }) as typeof fetch;
    await confirmAdjustment('trip/id', { proposal_id: 'p', revision: 4, options: [{ proposed_stops: [{ id: 'client-tampering' }] }] } as ReviewProposal, 'chosen');
  } finally { globalThis.fetch = original; }
});

test('old backend preview fails readably without applying a skip', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('{"status":"success","proposed_stops":[]}')) as typeof fetch;
    await assert.rejects(previewAdjustment('saved', { day_number: 1, target_activity_id: 'a', trigger: 'skip', expected_revision: 1, travel_mode: 'driving' }), /server needs the routing V2 update/);
  } finally { globalThis.fetch = original; }
});

test('day directions retain provenance and never manufacture road geometry', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ revision: 3, legs: [{ from_title: 'A', to_title: 'B', from_coords: [1, 2], to_coords: [1.1, 2], duration_minutes: 10, distance_km: 11,
      geometry: [], source: 'distance_estimate', confidence: 'Straight-line distance estimate' }] }))) as typeof fetch;
    const result = await fetchDayDirections('saved', 1, 'walking', new AbortController().signal);
    assert.equal(result.legs[0].status, 'fallback'); assert.equal(result.legs[0].steps.length, 0);
    assert.equal(result.legs[0].geometry.length, 2); assert.match(result.legs[0].errorMessage!, /Straight-line/);
  } finally { globalThis.fetch = original; }
});
