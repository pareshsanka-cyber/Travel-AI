import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, buildItineraryText, localTimeToUtc } from '../src/services/itineraryExport';
import { extractTripSummary } from '../src/services/api';
import { ItineraryDay } from '../src/types';

const trip = extractTripSummary({ id:'trip', destination:'Paris', days:1, travelers:2, revision:3, destination_timezone:'Europe/Paris' });
const days: ItineraryDay[] = [{ dayNumber:1, date:'December 1', isoDate:'2026-12-01', title:'Paris', transitBadge:'',
  activities:[{id:'museum', title:'Museum, art; gallery', timeOfDay:'Morning', time:'09:00', startTime:'09:00', endTime:'10:00',
    description:'Visit art\nConfirm hours', categoryColor:'primary', location:'Paris'}] }];

test('calendar exports actual activity dates, escaped text and UTC times', () => {
  const calendar = buildCalendar(trip, days, new Date('2026-10-14T10:00:00Z'));
  assert.ok(calendar.includes('DTSTART:20261201T080000Z'));
  assert.ok(calendar.includes('DTEND:20261201T090000Z'));
  assert.ok(calendar.includes('SUMMARY:Museum\\, art\\; gallery'));
  assert.ok(calendar.includes('UID:trip.museum.day1@travelai'));
  assert.ok(calendar.includes('SEQUENCE:3'));
  assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length,1);
  assert.ok(calendar.endsWith('\r\n'));
});

test('calendar honors destination daylight saving and detects missing clock times', () => {
  assert.equal(localTimeToUtc('2026-07-01','09:00','Europe/Paris').toISOString(),'2026-07-01T07:00:00.000Z');
  assert.throws(() => localTimeToUtc('2026-03-29','02:30','Europe/Paris'),/daylight-saving/);
  assert.throws(() => buildCalendar(trip,[{...days[0],isoDate:undefined}]),/verified dates/);
});

test('calendar folds long Unicode lines without breaking characters', () => {
  const calendar = buildCalendar(trip,[{...days[0],activities:[{...days[0].activities[0],title:'Musée '.repeat(40)}]}]);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line,'utf8') <= 75);
  assert.ok(calendar.replace(/\r\n /g,'').includes('SUMMARY:'+'Musée '.repeat(40)));
});

test('text sharing includes the actual itinerary instead of a private account URL', () => {
  const text = buildItineraryText(trip,days);
  assert.ok(text.includes('2026-12-01'));
  assert.ok(text.includes('Museum, art; gallery'));
  assert.ok(text.includes('Confirm reservations'));
  assert.ok(!text.includes('localhost'));
});
