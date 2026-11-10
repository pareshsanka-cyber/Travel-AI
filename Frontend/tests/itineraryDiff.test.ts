import test from 'node:test';
import assert from 'node:assert/strict';
import { computeItineraryDiff } from '../src/services/itineraryDiff';
import type { ItinerarySnapshot } from '../src/types';

test('detects added activities (🟩 +) when new stops are introduced', () => {
  const fromSnap: ItinerarySnapshot = {
    revision: 1,
    timestamp: '2026-11-01T10:00:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        title: 'Arrival in Panaji',
        activities: [
          { id: 'act-1', title: 'Fontainhas Heritage Walk', time: '10:00 - 12:00', location: 'Panaji', type: 'sightseeing' },
        ],
      },
    ],
  };

  const toSnap: ItinerarySnapshot = {
    revision: 2,
    timestamp: '2026-11-01T10:05:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        title: 'Arrival in Panaji',
        activities: [
          { id: 'act-1', title: 'Fontainhas Heritage Walk', time: '10:00 - 12:00', location: 'Panaji', type: 'sightseeing' },
          { id: 'act-2', title: 'Miramar Beach Sunset', time: '17:00 - 18:30', location: 'Miramar', type: 'leisure' },
        ],
      },
    ],
  };

  const diff = computeItineraryDiff(fromSnap, toSnap);

  assert.equal(diff.fromRevision, 1);
  assert.equal(diff.toRevision, 2);
  assert.equal(diff.totalAdded, 1);
  assert.equal(diff.totalRemoved, 0);
  assert.equal(diff.totalRescheduled, 0);
  assert.equal(diff.totalChanges, 1);

  const day1 = diff.dayDiffs[0];
  const addedItem = day1.items.find((i) => i.id === 'act-2');
  assert.ok(addedItem, 'act-2 should exist in diff');
  assert.equal(addedItem.changeType, 'added');
  assert.equal(addedItem.currentTime, '17:00 - 18:30');
});

test('detects removed or replaced activities (🟥 -)', () => {
  const fromSnap: ItinerarySnapshot = {
    revision: 1,
    timestamp: '2026-11-01T10:00:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        title: 'South Goa Explorer',
        activities: [
          { id: 'act-1', title: 'Colva Beach', time: '09:00 - 11:00', location: 'Colva', type: 'beach' },
          { id: 'act-2', title: 'Spice Plantation Tour', time: '12:00 - 15:00', location: 'Ponda', type: 'tour' },
        ],
      },
    ],
  };

  const toSnap: ItinerarySnapshot = {
    revision: 2,
    timestamp: '2026-11-01T10:05:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        title: 'South Goa Explorer',
        activities: [
          { id: 'act-1', title: 'Colva Beach', time: '09:00 - 11:00', location: 'Colva', type: 'beach' },
        ],
      },
    ],
  };

  const diff = computeItineraryDiff(fromSnap, toSnap);

  assert.equal(diff.totalAdded, 0);
  assert.equal(diff.totalRemoved, 1);
  assert.equal(diff.totalRescheduled, 0);
  assert.equal(diff.totalChanges, 1);

  const day1 = diff.dayDiffs[0];
  const removedItem = day1.items.find((i) => i.id === 'act-2');
  assert.ok(removedItem, 'act-2 should be marked removed');
  assert.equal(removedItem.changeType, 'removed');
  assert.equal(removedItem.previousTime, '12:00 - 15:00');
});

test('detects rescheduled time slots (🟨 ~) and preserves previous vs updated time', () => {
  const fromSnap: ItinerarySnapshot = {
    revision: 1,
    timestamp: '2026-11-01T10:00:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        activities: [
          { id: 'act-1', title: 'Aguada Fort', time: '09:30 - 11:00', location: 'Candolim' },
        ],
      },
    ],
  };

  const toSnap: ItinerarySnapshot = {
    revision: 2,
    timestamp: '2026-11-01T10:05:00Z',
    days: [
      {
        dayNumber: 1,
        date: '2026-11-02',
        activities: [
          { id: 'act-1', title: 'Aguada Fort', time: '15:30 - 17:00', location: 'Candolim' },
        ],
      },
    ],
  };

  const diff = computeItineraryDiff(fromSnap, toSnap);

  assert.equal(diff.totalAdded, 0);
  assert.equal(diff.totalRemoved, 0);
  assert.equal(diff.totalRescheduled, 1);
  assert.equal(diff.totalChanges, 1);

  const item = diff.dayDiffs[0].items[0];
  assert.equal(item.changeType, 'rescheduled');
  assert.equal(item.previousTime, '09:30 - 11:00');
  assert.equal(item.currentTime, '15:30 - 17:00');
});

test('matches activities by normalized title if activity IDs change between revisions', () => {
  const fromSnap: ItinerarySnapshot = {
    revision: 1,
    timestamp: '2026-11-01T10:00:00Z',
    days: [
      {
        dayNumber: 1,
        activities: [
          { id: 'old-id-999', title: 'Basilica of Bom Jesus', time: '10:00 - 11:30' },
        ],
      },
    ],
  };

  const toSnap: ItinerarySnapshot = {
    revision: 2,
    timestamp: '2026-11-01T10:05:00Z',
    days: [
      {
        dayNumber: 1,
        activities: [
          { id: 'new-id-123', title: 'basilica of bom jesus!', time: '11:00 - 12:30' },
        ],
      },
    ],
  };

  const diff = computeItineraryDiff(fromSnap, toSnap);

  assert.equal(diff.totalAdded, 0, 'Should not count as added when titles match');
  assert.equal(diff.totalRemoved, 0, 'Should not count as removed when titles match');
  assert.equal(diff.totalRescheduled, 1, 'Should recognize rescheduled timing');
  assert.equal(diff.dayDiffs[0].items[0].changeType, 'rescheduled');
  assert.equal(diff.dayDiffs[0].items[0].previousTime, '10:00 - 11:30');
  assert.equal(diff.dayDiffs[0].items[0].currentTime, '11:00 - 12:30');
});

test('handles multi-day differences accurately', () => {
  const fromSnap: ItinerarySnapshot = {
    revision: 1,
    timestamp: '2026-11-01T10:00:00Z',
    days: [
      {
        dayNumber: 1,
        activities: [{ id: 'd1-a1', title: 'Day 1 Morning', time: '09:00 - 10:00' }],
      },
      {
        dayNumber: 2,
        activities: [{ id: 'd2-a1', title: 'Day 2 Beach', time: '14:00 - 16:00' }],
      },
    ],
  };

  const toSnap: ItinerarySnapshot = {
    revision: 2,
    timestamp: '2026-11-01T10:05:00Z',
    days: [
      {
        dayNumber: 1,
        activities: [{ id: 'd1-a1', title: 'Day 1 Morning', time: '09:00 - 10:00' }], // unchanged
      },
      {
        dayNumber: 2,
        activities: [], // removed d2-a1
      },
      {
        dayNumber: 3,
        activities: [{ id: 'd3-a1', title: 'Day 3 Departure', time: '11:00 - 13:00' }], // added day 3
      },
    ],
  };

  const diff = computeItineraryDiff(fromSnap, toSnap);

  assert.equal(diff.dayDiffs.length, 3);
  assert.equal(diff.totalAdded, 1);
  assert.equal(diff.totalRemoved, 1);
  assert.equal(diff.totalRescheduled, 0);
  assert.equal(diff.totalChanges, 2);

  // Day 1 unchanged
  assert.equal(diff.dayDiffs[0].items[0].changeType, 'unchanged');
  // Day 2 removed
  assert.equal(diff.dayDiffs[1].items[0].changeType, 'removed');
  // Day 3 added
  assert.equal(diff.dayDiffs[2].items[0].changeType, 'added');
});
