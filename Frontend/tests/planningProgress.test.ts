import test from 'node:test';
import assert from 'node:assert/strict';
import { planningSteps } from '../src/services/planningProgressModel';
import type { PlanningProgress } from '../src/services/planningProgress';

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
