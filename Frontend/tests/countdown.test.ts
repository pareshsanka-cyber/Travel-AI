import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySegment } from '../src/types';
import { countdownDisplay, countdownTarget, uniqueScheduledInstant } from '../src/motion/countdown';
import { extractTripSummary } from '../src/services/api';
import { changedRerouteIds } from '../src/motion/rerouteDiff';
import { claimRouteReveal } from '../src/motion/routeMotion';

const activity = { title: 'Harbour', type: 'attraction', startTime: '09:00', timezone: 'Australia/Sydney' } as ActivitySegment;
const day = { isoDate: '2026-10-22' };

test('countdown resolves destination time independently of the browser timezone', () => {
  assert.equal(countdownTarget(activity, day).timestamp, Date.parse('2026-10-21T22:00:00Z'));
  assert.equal(uniqueScheduledInstant('2026-10-22', '09:00', 'Asia/Kathmandu'), Date.parse('2026-10-22T03:15:00Z'));
  assert.equal(countdownTarget({ ...activity, scheduledDate: '2026-10-23' }, day).timestamp, Date.parse('2026-10-22T22:00:00Z'));
});
test('only explicit timezones qualify, and airports require their own timezone', () => {
  const missing = { ...activity, timezone: undefined };
  assert.equal(countdownTarget(missing, day).timestamp, null);
  assert.notEqual(countdownTarget(missing, day, 'Australia/Sydney').timestamp, null);
  assert.equal(countdownTarget({ ...missing, type: 'airport' }, day, 'Australia/Sydney').timestamp, null);
  assert.equal(countdownTarget({ ...missing, title: 'Departure Airport' }, day, 'Australia/Sydney').timestamp, null);
  assert.equal(countdownTarget({ ...activity, type: 'airport', timezone: 'Asia/Kolkata' }, day).timestamp, Date.parse('2026-10-22T03:30:00Z'));
});
test('display defaults cannot silently become authoritative schedule timezones', () => {
  const fallback = extractTripSummary({ id: 'legacy', destination: 'Sydney', days: 2 });
  assert.equal(fallback.destinationTimezone, 'Asia/Kolkata');
  assert.equal(fallback.scheduleTimezone, undefined);
  assert.equal(extractTripSummary({ destination_timezone: 'Australia/Sydney' }).scheduleTimezone, 'Australia/Sydney');
});
test('missing, malformed and impossible schedule values stay unavailable', () => {
  for (const [date, time, zone] of [['2026-02-30', '09:00', 'UTC'], ['2026-10-22', '25:00', 'UTC'],
    ['2026-10-22', '', 'UTC'], ['2026-10-22', '09:00', 'Unknown/Place'], ['', '09:00', 'UTC']]) {
    assert.equal(uniqueScheduledInstant(date, time, zone), null);
  }
  assert.equal(countdownDisplay(countdownTarget({ ...activity, startTime: undefined }, day), Date.now()).label, 'Countdown unavailable');
});
test('daylight-saving repeated hours and nonexistent hours are rejected', () => {
  assert.equal(uniqueScheduledInstant('2026-11-01', '01:30', 'America/New_York'), null);
  assert.equal(uniqueScheduledInstant('2026-03-08', '02:30', 'America/New_York'), null);
  assert.equal(uniqueScheduledInstant('2026-04-05', '01:45', 'Australia/Lord_Howe'), null);
  assert.equal(uniqueScheduledInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'), null);
  assert.notEqual(uniqueScheduledInstant('2026-03-08', '03:30', 'America/New_York'), null);
});
test('format boundaries, passed starts and historical dates never show negative counters', () => {
  const target = countdownTarget(activity, day), at = target.timestamp!;
  assert.equal(countdownDisplay(target, at - 90000000).value, '1d 1h');
  assert.equal(countdownDisplay(target, at - 86400000).value, '24:00:00');
  assert.equal(countdownDisplay(target, at - 45000).value, '00:00:45');
  assert.equal(countdownDisplay(target, at).label, 'Scheduled start has passed');
  assert.equal(countdownDisplay(target, at + 86400000).label, 'Past itinerary');
});
test('reroute changes follow server IDs and timing differences, not row positions or labels', () => {
  const old = [{ id: 'a', start_time: '09:00' }, { id: 'b', start_time: '11:00' }];
  assert.deepEqual([...changedRerouteIds(old, [old[1], { ...old[0], status_label: 'Rescheduled' }])], []);
  assert.deepEqual([...changedRerouteIds(old, [{ ...old[1], start_time: '12:00' }, { id: 'replacement' }])], ['b', 'replacement']);
});
test('a route reveals only for a new day or changed geometry, independently per trip', () => {
  assert.equal(claimRouteReveal('test-trip/day1', 'geometry1'), true);
  assert.equal(claimRouteReveal('test-trip/day1', 'geometry1'), false);
  assert.equal(claimRouteReveal('test-trip/day1', 'geometry2'), true);
  assert.equal(claimRouteReveal('other-trip/day1', 'geometry1'), true);
});
