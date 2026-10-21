import test from 'node:test';
import assert from 'node:assert/strict';
import { DESTINATIONS, matchingDestinations, destinationKey } from '../src/components/preferences/tripDetailsModel';
import { externalTravelUrl } from '../src/services/discovery';
import { fetchFlightOptions, extractTripSummary } from '../src/services/api';

test('Bengaluru and Bangalore resolve to one canonical choice without changing the original six', () => {
  assert.deepEqual(DESTINATIONS.slice(0, 6).map(d => d.city), ['Goa', 'Jaipur', 'Kerala', 'Ladakh', 'Mumbai', 'New Delhi']);
  for (const name of ['Bangalore', 'bengaluru', ' Bangalore, India ']) {
    assert.equal(matchingDestinations(name)[0].value, 'Bengaluru, India');
  }
  assert.equal(destinationKey('Bangalore, India'), destinationKey('Bengaluru, India'));
  for (const city of ['Hyderabad', 'Chennai', 'Kolkata']) assert.equal(matchingDestinations(city)[0].city, city);
  assert.deepEqual(matchingDestinations('Custom village'), []);
});

test('external travel links encode saved cities, dates and quantities', () => {
  const trip = extractTripSummary({ id: 't', origin: 'Hyderabad', destination: 'Bengaluru, India', travelers: 3,
    start_date: '2030-11-02', end_date: '2030-11-04' });
  const flight = new URL(externalTravelUrl('flight', trip));
  const hotel = new URL(externalTravelUrl('hotel', trip));
  assert.match(flight.searchParams.get('q')!, /Hyderabad.*Bengaluru.*2030-11-02.*3 travelers/);
  assert.match(hotel.searchParams.get('q')!, /2030-11-02 to 2030-11-04.*3 guests/);
});

test('newly discovered flight options respect an explicitly empty selection', () => {
  const trip = { id: 't', flights: [{ id: 'new', price: 2000 }], selections: { flight_id: null } };
  assert.equal(fetchFlightOptions(trip)[0].isSelected, false);
  assert.equal(fetchFlightOptions({ ...trip, selections: undefined })[0].isSelected, true);
});

test('both product statuses retain safe failure reasons and tolerate old records', () => {
  const trip = extractTripSummary({ id: 't', flight_metadata: { data_status: 'error', failure_reason: 'quota_exhausted', title: 'Live-search credits exhausted' },
    hotel_metadata: { data_status: 'error', failure_reason: 'invalid_credentials', message: 'Update credentials' } });
  assert.equal(trip.flightMetadata?.failureReason, 'quota_exhausted');
  assert.equal(trip.hotelMetadata?.failureReason, 'invalid_credentials');
  assert.equal(extractTripSummary({ id: 'old' }).hotelMetadata, undefined);
});
