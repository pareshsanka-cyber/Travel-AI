import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripReadiness, ReadinessInput } from '../src/services/tripReadiness';

function fixture(): ReadinessInput {
  return { trip: { id: 'trip-1', startDate: '2026-10-21', endDate: '2026-10-22' } as ReadinessInput['trip'],
    days: [{ dayNumber: 1, activities: [{ id: 'visit', title: 'Museum', type: 'attraction', operatingHours: ['09:00–17:00'] }] }] as ReadinessInput['days'],
    flights: [{ id: 'flight-1', airlineCode: 'TA', flightNumber: '101', pricePerPerson: 5000, isSelected: true }] as ReadinessInput['flights'],
    hotels: [{ id: 'hotel-1', name: 'Saved hotel', pricePerNight: 2500 }] as ReadinessInput['hotels'],
    weather: { dailyForecast: [{ date: '2026-10-21', tempHigh: 26, tempLow: 20 }, { date: '2026-10-22', tempHigh: 27, tempLow: 20 }] } as ReadinessInput['weather'],
    budget: { totalBudget: 25000, allocatedExpenditure: 15000, isComplete: true } as ReadinessInput['budget'],
    bookingState: 'loaded', bookings: [] };
}
const item = (input: ReadinessInput, id: string) => buildTripReadiness(input).find(row => row.id === id)!;

test('readiness is read-only, and planned options never imply a booking', () => {
  const input = fixture(), original = structuredClone(input);
  assert.equal(item(input, 'flight').status, 'ready');
  assert.match(item(input, 'flight').detail, /no demo booking confirmed/i);
  assert.match(item(input, 'hotel').summary, /Saved hotel/); // Effective first hotel, including legacy trips.
  assert.deepEqual(input, original);
  assert.equal(buildTripReadiness(input).length, 5);
});

test('only matching current discovered success counts, and it beats later failures', () => {
  const input = fixture();
  const snapshot = { kind: 'flight', source: 'discovered', option_id: 'flight-1' } as NonNullable<NonNullable<ReadinessInput['bookings']>[number]['booking']>;
  input.bookings = [{ trip_id: 'trip-1', status: 'failed', booking: snapshot }, { trip_id: 'trip-1', status: 'succeeded', booking: snapshot }];
  assert.match(item(input, 'flight').detail, /Booked — Demo/);
  input.bookings = [{ trip_id: 'trip-1', status: 'succeeded', booking: { ...snapshot, source: 'sample' } }, { trip_id: 'other-trip', status: 'succeeded', booking: snapshot }];
  assert.doesNotMatch(item(input, 'flight').detail, /Booked — Demo/);
  input.bookingState = 'loading'; assert.match(item(input, 'flight').detail, /Checking/);
  input.bookingState = 'unavailable'; assert.match(item(input, 'flight').detail, /unavailable/);
});

test('explicit hotel selections include nearby hotels, without modifying primary choices', () => {
  const input = fixture();
  input.nearbyHotels = [{ id: 'nearby', name: 'Chosen nearby hotel', pricePerNight: 1000, isSelected: true }] as ReadinessInput['hotels'];
  assert.match(item(input, 'hotel').summary, /Chosen nearby hotel/);
  input.nearbyHotels[0].pricePerNight = 0;
  assert.equal(item(input, 'hotel').status, 'review');
});

test('missing, zero and malformed prices need review rather than a fabricated total', () => {
  const input = fixture();
  input.flights[0].pricePerPerson = NaN;
  input.hotels = [];
  assert.equal(item(input, 'flight').status, 'review');
  assert.match(item(input, 'hotel').summary, /No hotel/);
  input.flights = []; assert.equal(item(input, 'flight').status, 'review');
});

test('forecast must cover every saved trip date with usable temperatures', () => {
  const input = fixture();
  assert.equal(item(input, 'weather').status, 'ready');
  input.weather!.dailyForecast.pop(); assert.match(item(input, 'weather').summary, /1 of 2/);
  input.weather!.dailyForecast[0].date = '2026-11-01';
  assert.equal(item(input, 'weather').status, 'review'); // Upcoming weather cannot stand in for trip weather.
  input.weather!.dailyForecast[0].date = '2026-10-21';
  input.weather!.dailyForecast[0].tempHigh = null; assert.match(item(input, 'weather').summary, /No complete/);
});

test('invalid dates, unavailable forecasts and duplicate dates cannot claim complete coverage', () => {
  const input = fixture();
  input.weather!.data_status = 'unavailable'; assert.equal(item(input, 'weather').status, 'review');
  delete input.weather!.data_status;
  input.weather!.dailyForecast[1].date = '2026-10-21'; assert.equal(item(input, 'weather').status, 'review');
  input.trip.startDate = '2026-02-30'; assert.equal(item(input, 'weather').status, 'review');
  input.trip.startDate = undefined; assert.equal(item(input, 'weather').status, 'review');
});

test('unknown estimates and overspending need review even when completeness is true', () => {
  const input = fixture();
  assert.equal(item(input, 'budget').status, 'ready');
  input.budget!.isComplete = false; assert.match(item(input, 'budget').summary, /incomplete/);
  input.budget!.isComplete = true; input.budget!.allocatedExpenditure = 30000;
  assert.match(item(input, 'budget').summary, /exceed/);
  input.budget!.allocatedExpenditure = NaN; assert.match(item(input, 'budget').summary, /No usable/);
  input.budget = null; assert.equal(item(input, 'budget').status, 'review');
});

test('closed and unknown venue hours are disclosed; transit and free time are excluded', () => {
  const input = fixture();
  assert.equal(item(input, 'hours').status, 'info');
  assert.match(item(input, 'hours').detail, /do not guarantee/);
  const visit = input.days[0].activities[0];
  visit.operatingStatus = 'CLOSED'; assert.match(item(input, 'hours').summary, /marked closed/);
  visit.operatingStatus = 'UNKNOWN'; assert.match(item(input, 'hours').summary, /hours checked/);
  delete visit.operatingHours; visit.type = 'airport';
  assert.match(item(input, 'hours').summary, /No sightseeing/);
  visit.type = 'restaurant'; visit.isMealBreak = true;
  assert.equal(item(input, 'hours').status, 'info');
});
