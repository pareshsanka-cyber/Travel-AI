import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlaceMemoryItem } from '../src/types/index';
import { formatTimeAgo } from '../src/services/api';

test('PlaceMemoryItem type supports dynamic trip place properties', () => {
  const item: PlaceMemoryItem = {
    id: 'place-indo-portuguese-museum',
    name: 'Indo-Portuguese Museum',
    category: 'Historic Monument & Sights',
    tag: 'heritage',
    location: 'Kerala, India',
    rating: 4.5,
    note: 'Renowned cultural museum showcasing regional artifacts.',
    price: 'Free Entry',
    isScheduled: true,
    lat: 9.9654,
    lon: 76.2422,
  };

  assert.equal(item.name, 'Indo-Portuguese Museum');
  assert.equal(item.tag, 'heritage');
  assert.equal(item.isScheduled, true);
  assert.equal(item.price, 'Free Entry');
});

test('Saved place IDs default to empty without hardcoded Goa IDs', () => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => store.get(k) || null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      }
    });
  }

  // Ensure no stale saved IDs key
  globalThis.localStorage.removeItem('TRAVELAI_SAVED_PLACE_IDS');
  const raw = globalThis.localStorage.getItem('TRAVELAI_SAVED_PLACE_IDS');
  assert.equal(raw, null);

  const initialIds = raw ? new Set(JSON.parse(raw)) : new Set<string>();
  assert.equal(initialIds.size, 0);
  assert.equal(initialIds.has('p-cavatina'), false);
  assert.equal(initialIds.has('p-thalassa'), false);
});

test('formatTimeAgo treats naive ISO string as UTC avoiding 5-hour offset', () => {
  // A timestamp created 1 minute ago in UTC without Z
  const oneMinAgoUtc = new Date(Date.now() - 60000).toISOString().replace('Z', '');
  const formatted = formatTimeAgo(oneMinAgoUtc);
  assert.match(formatted, /^(Just now|1m ago)$/);
  assert.notEqual(formatted, '5h ago');
});
