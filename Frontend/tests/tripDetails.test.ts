import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftUpdates, validateDraft, uniqueInterests, addDays, inclusiveDays, isoDate, localDate, BUDGET_PRESETS } from '../src/components/preferences/tripDetailsModel';

test('existing family breakdown and custom planning values survive applying unchanged details', () => {
  const context = { origin: 'Custom city', destination: 'Small village', travelers: 5, adults: 2, children: 2, infants: 1,
    interests: ['Nature & Parks', 'Astrophotography'], currency: 'CAD', budget: 3200 };
  const draft = createDraft(context), updates = draftUpdates(draft);
  assert.equal(validateDraft(draft, context), '');
  assert.deepEqual([updates.adults, updates.children, updates.infants, updates.travelers], [2, 2, 1, 5]);
  assert.deepEqual(updates.interests, context.interests); assert.deepEqual(updates.preferences, context.interests);
  assert.equal(updates.currency, 'CAD'); assert.equal(updates.budget, 3200); assert.equal(updates.destination, 'Small village');
  assert.deepEqual(context.interests, ['Nature & Parks', 'Astrophotography']);
});
test('legacy total becomes adults and new trips begin with one adult', () => {
  assert.equal(createDraft({ travelers: 7 }).adults, 7);
  assert.equal(createDraft({ travelers: 7 }).children, 0);
  assert.equal(createDraft(undefined).adults, 1);
  const oversized = createDraft({ travelers: 25 });
  assert.equal(oversized.adults, 25); // Never silently truncate older saved preferences.
  assert.match(validateDraft(oversized, {}), /1–20/);
});
test('interest aliases deduplicate without losing custom names or rewriting saved labels', () => {
  assert.deepEqual(uniqueInterests([' Nature & Parks ', 'nature', 'Photography', ' photography ', '']), ['Nature & Parks', 'Photography']);
  assert.deepEqual(createDraft({ preferences: 'Food, Bird watching, food' }).interests, ['Food', 'Bird watching']);
});
test('inclusive shortcuts work across leap years, year boundaries and DST weekends', () => {
  assert.equal(addDays('2028-02-28', 2), '2028-03-01');
  assert.equal(addDays('2030-12-30', 4), '2031-01-03');
  assert.equal(inclusiveDays('2026-10-31', '2026-11-02'), 3);
  assert.equal(isoDate('2030-02-30'), '');
  assert.equal(localDate(new Date(2030, 5, 15, 0, 5)), '2030-06-15');
});
test('unchanged historical dates are preserved but new past dates and reversed ranges fail', () => {
  const context = { start_date: '2026-01-01', end_date: '2026-01-03' }, draft = createDraft(context);
  assert.equal(validateDraft(draft, context, '2030-06-15'), '');
  assert.match(validateDraft({ ...draft, start_date: '2026-01-02' }, context, '2030-06-15'), /today or future/);
  assert.match(validateDraft({ ...draft, start_date: '2030-06-20', end_date: '2030-06-19' }, context, '2030-06-15'), /on or after/);
});
test('total travelers and budget validation enforce the existing limits', () => {
  const draft = createDraft({});
  assert.match(validateDraft({ ...draft, adults: 0 }, {}), /at least one adult/);
  assert.match(validateDraft({ ...draft, adults: 19, children: 1, infants: 1 }, {}), /1–20/);
  assert.equal(validateDraft({ ...draft, adults: 19, infants: 1 }, {}), '');
  assert.match(validateDraft({ ...draft, budget: '-5' }, {}), /greater than zero/);
  assert.equal(draftUpdates({ ...draft, budget: '50000', currency: 'USD' }).budget, 50000);
  assert.equal(BUDGET_PRESETS.INR[0], 30000); assert.equal(BUDGET_PRESETS.USD[0], 1000);
});
