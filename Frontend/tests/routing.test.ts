import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLegDirections, isFlightConnection, validRouteCoordinates } from '../src/services/routingService';
import type { ActivitySegment } from '../src/types';

const payload = { routes: [{ distance: 1200, duration: 240,
  geometry: { coordinates: [[78.4, 17.4], [78.41, 17.41]] }, legs: [{ steps: [] }] }] };

test('concurrent driving/cab requests share a route and cached results retain their own labels', async () => {
  const original = globalThis.fetch;
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => { count++; await gate; return new Response(JSON.stringify(payload)); }) as typeof fetch;
  try {
    const a = fetchLegDirections([17.4, 78.4], [17.41, 78.41], 'First', 'Second');
    const b = fetchLegDirections([17.4, 78.4], [17.41, 78.41], 'Cab start', 'Cab end', 'cab');
    release();
    const [drive, cab] = await Promise.all([a, b]);
    assert.equal(count, 1); assert.equal(cab.fromTitle, 'Cab start'); assert.equal(cab.mode, 'cab');
    drive.geometry[0][0] = 99;
    const cached = await fetchLegDirections([17.4, 78.4], [17.41, 78.41], 'Renamed', 'Arrival');
    assert.equal(count, 1); assert.equal(cached.fromTitle, 'Renamed'); assert.equal(cached.geometry[0][0], 17.4);
  } finally { globalThis.fetch = original; }
});

test('one cancelled subscriber cannot cancel another subscriber sharing the route', async () => {
  const original = globalThis.fetch;
  let release!: () => void; let aborted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (_url, options) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; });
    await gate; return new Response(JSON.stringify(payload));
  }) as typeof fetch;
  try {
    const cancel = new AbortController();
    const a = fetchLegDirections([17.5, 78.4], [17.51, 78.41], 'A', 'B', 'driving', cancel.signal);
    const b = fetchLegDirections([17.5, 78.4], [17.51, 78.41], 'C', 'D');
    cancel.abort(); await assert.rejects(a, { name: 'AbortError' });
    assert.equal(aborted, false); release(); assert.equal((await b).status, 'ok');
  } finally { globalThis.fetch = original; }
});

test('the last cancelled subscriber aborts the network and a later visit can retry', async () => {
  const original = globalThis.fetch;
  let count = 0; let aborted = false;
  globalThis.fetch = (async (_url, options) => {
    count++;
    if (count > 1) return new Response(JSON.stringify(payload));
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => {
      aborted = true; reject(new DOMException('cancel', 'AbortError'));
    }));
  }) as typeof fetch;
  try {
    const cancel = new AbortController();
    const pending = fetchLegDirections([17.6, 78.4], [17.61, 78.41], 'A', 'B', 'driving', cancel.signal);
    cancel.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(aborted, true);
    assert.equal((await fetchLegDirections([17.6, 78.4], [17.61, 78.41], 'A', 'B')).status, 'ok');
    assert.equal(count, 2);
  } finally { globalThis.fetch = original; }
});

test('unavailable or malformed routes stay estimates and retry after their short cache lifetime', async () => {
  const original = globalThis.fetch; const clock = Date.now;
  let count = 0; let now = clock();
  Date.now = () => now;
  globalThis.fetch = (async () => {
    count++; return new Response(JSON.stringify(count === 1 ? { routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[900, 900]] } }] } : payload));
  }) as typeof fetch;
  try {
    const a = await fetchLegDirections([17.7, 78.4], [17.71, 78.41], 'A', 'B');
    assert.equal(a.status, 'fallback'); assert.deepEqual(a.steps, []);
    assert.equal((await fetchLegDirections([17.7, 78.4], [17.71, 78.41], 'A', 'B')).status, 'fallback');
    assert.equal(count, 1); now += 11000;
    assert.equal((await fetchLegDirections([17.7, 78.4], [17.71, 78.41], 'A', 'B')).status, 'ok');
    assert.equal(count, 2);
  } finally { globalThis.fetch = original; Date.now = clock; }
});

test('timeout remains active while the route response body is pending', async context => {
  const original = globalThis.fetch;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let bodyStarted!: () => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  globalThis.fetch = (async (_url, options) => ({ ok: true,
    json: () => { bodyStarted(); return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))); },
  })) as typeof fetch;
  try {
    const pending = fetchLegDirections([17.8, 78.4], [17.81, 78.41], 'A', 'B');
    await started; context.mock.timers.tick(7000);
    const result = await pending; assert.equal(result.status, 'fallback'); assert.match(result.errorMessage!, /timed out/);
  } finally { globalThis.fetch = original; context.mock.timers.reset(); }
});

test('invalid coordinates cannot trigger invented routes, and distance alone cannot imply flight', async () => {
  assert.equal(validRouteCoordinates([0, 20]), true);
  for (const coords of [[0, 0], [Infinity, 20], [91, 20], [20, NaN], [undefined, undefined]]) {
    assert.equal(validRouteCoordinates(coords), false);
    assert.equal((await fetchLegDirections(coords as [number, number], [17, 78], 'A', 'B')).status, 'no_route');
  }
  const from = { type: 'attraction', lat: 17.4, lon: 78.4 } as ActivitySegment;
  const to = { type: 'attraction', lat: -33.8, lon: 151.2 } as ActivitySegment;
  assert.equal(isFlightConnection(from, to), false);
  assert.equal(isFlightConnection({ ...from, type: 'airport' }, { ...to, type: 'airport' }), true);
  assert.equal(isFlightConnection(from, { ...to, travelMode: 'flight' }), true);
});
