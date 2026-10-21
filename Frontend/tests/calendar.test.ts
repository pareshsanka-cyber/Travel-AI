import test from 'node:test';
import assert from 'node:assert/strict';
import { monthCells, shiftMonth, monthStart, keyboardDate, formatCalendarDate } from '../src/components/preferences/calendarModel';
import { createDraft, validateDraft } from '../src/components/preferences/tripDetailsModel';

test('calendar uses Monday-first stable six-week grids without adjacent-month duplicates', () => {
  const days = monthCells('2026-10-01');
  assert.equal(days.length, 42);
  assert.deepEqual(days.slice(0, 5), [null, null, null, '2026-10-01', '2026-10-02']);
  assert.equal(days.filter(Boolean).length, 31);
  assert.equal(new Set(days.filter(Boolean)).size, 31);
  assert.equal(monthCells('2028-02-01').filter(Boolean).length, 29);
  assert.deepEqual(monthCells('not-a-date'), []);
});
test('month and year navigation clamp day numbers across leap years and year boundaries', () => {
  assert.equal(shiftMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(shiftMonth('2028-02-29', 12), '2029-02-28');
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-31');
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-31');
  assert.equal(monthStart('2026-10-20'), '2026-10-01');
  assert.equal(shiftMonth('', 1), '');
});
test('calendar keyboard navigation follows real dates across daylight-saving changes', () => {
  assert.equal(keyboardDate('2026-10-31', 'ArrowRight'), '2026-11-01');
  assert.equal(keyboardDate('2026-11-01', 'ArrowLeft'), '2026-10-31');
  assert.equal(keyboardDate('2026-11-01', 'ArrowUp'), '2026-10-25');
  assert.equal(keyboardDate('2026-11-01', 'Home'), '2026-10-26');
  assert.equal(keyboardDate('2026-11-01', 'End'), '2026-11-01');
  assert.equal(keyboardDate('2028-02-29', 'PageDown', true), '2029-02-28');
  assert.equal(keyboardDate('2028-03-31', 'PageUp'), '2028-02-29');
  assert.equal(keyboardDate('2026-10-20', 'Enter'), '');
});
test('readable date labels do not shift to the previous day in western timezones', () => {
  assert.equal(formatCalendarDate('2026-10-20'), '20 October 2026');
  assert.equal(formatCalendarDate(''), '');
  for (const partial of ['2030-9', '2030-06', '2030/06/15']) {
    assert.equal(formatCalendarDate(partial), '');
    assert.equal(monthStart(partial), '');
    assert.deepEqual(monthCells(partial), []);
  }
});
test('typed dates reject impossible and partial values while saved historical dates remain valid', () => {
  const draft = createDraft({ start_date: '2020-01-01', end_date: '2020-01-03' });
  assert.equal(validateDraft(draft, { start_date: '2020-01-01', end_date: '2020-01-03' }, '2026-10-20'), '');
  for (const date of ['2030-02-30', '2030-99-01', '2030-06', '2030/06/01']) {
    assert.match(validateDraft({ ...draft, start_date: date }, {}, '2026-10-20'), /valid dates/);
  }
});
