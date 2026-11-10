import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlanningProgress } from '../src/services/planningProgress';
import {
  planningSteps,
  getCoreServiceChecks,
  calculateProgressPercentage,
  getStageDescription,
} from '../src/services/planningProgressModel';

const baseProgress: PlanningProgress = {
  request_id: 'test-req-001',
  status: 'running',
  kind: 'planning',
  stages: {},
};

test('planningSteps returns all 7 sequence stages', () => {
  const steps = planningSteps(baseProgress);
  assert.equal(steps.length, 7);
  assert.deepEqual(
    steps.map(s => s.id),
    ['analysis', 'outline', 'discovery', 'budget', 'schedule', 'validation', 'saving']
  );
  // Initial state should be waiting
  assert.ok(steps.every(s => s.status === 'waiting'));
});

test('getCoreServiceChecks extracts the 4 required travel pillars', () => {
  const progress: PlanningProgress = {
    ...baseProgress,
    stages: {
      attractions: { status: 'done', note: 'Top sights found' },
      restaurants: { status: 'done', note: 'Local dining verified' },
      flights: { status: 'running' },
      hotels: { status: 'waiting' },
      route: { status: 'waiting' },
      budget: { status: 'waiting' },
      opening_hours: { status: 'waiting' },
      reviewer: { status: 'waiting' },
    },
  };

  const checks = getCoreServiceChecks(progress);
  assert.equal(checks.length, 4);

  const [attr, travel, schedule, hours] = checks;
  assert.equal(attr.id, 'attractions');
  assert.equal(attr.status, 'done');

  assert.equal(travel.id, 'flights-hotels');
  assert.equal(travel.status, 'running');

  assert.equal(schedule.id, 'schedule');
  assert.equal(schedule.status, 'waiting');

  assert.equal(hours.id, 'opening-hours');
  assert.equal(hours.status, 'waiting');
});

test('calculateProgressPercentage reflects real completed events and clamps appropriately', () => {
  assert.equal(calculateProgressPercentage({ ...baseProgress, status: 'succeeded' }), 100);
  assert.equal(calculateProgressPercentage({ ...baseProgress, status: 'failed' }), 0);
  assert.equal(calculateProgressPercentage({ ...baseProgress, status: 'interrupted' }), 0);

  // Partial progress
  const partial: PlanningProgress = {
    ...baseProgress,
    stages: {
      analysis: { status: 'done' },
      parser: { status: 'done' },
      planner: { status: 'done' },
      attractions: { status: 'running' },
    },
  };

  const pct = calculateProgressPercentage(partial);
  assert.ok(pct >= 20 && pct <= 90, `Expected percentage between 20 and 90, got ${pct}`);
});

test('getStageDescription produces accurate real-time context hints', () => {
  assert.ok(
    getStageDescription({
      ...baseProgress,
      stages: { attractions: { status: 'running' } },
    }).includes('attractions')
  );

  assert.ok(
    getStageDescription({
      ...baseProgress,
      stages: { flights: { status: 'running' } },
    }).includes('flight')
  );

  assert.ok(
    getStageDescription({
      ...baseProgress,
      stages: { route: { status: 'running' } },
    }).includes('routes')
  );

  assert.ok(
    getStageDescription({
      ...baseProgress,
      stages: { opening_hours: { status: 'running' } },
    }).includes('opening hours')
  );

  assert.ok(
    getStageDescription({
      ...baseProgress,
      status: 'succeeded',
    }).includes('ready')
  );
});

test('completed state marks all steps as done and percentage as 100%', () => {
  const completed: PlanningProgress = {
    ...baseProgress,
    status: 'succeeded',
  };

  const steps = planningSteps(completed);
  assert.ok(steps.every(s => s.status === 'done'));

  const checks = getCoreServiceChecks(completed);
  assert.ok(checks.every(c => c.status === 'done'));

  assert.equal(calculateProgressPercentage(completed), 100);
});
