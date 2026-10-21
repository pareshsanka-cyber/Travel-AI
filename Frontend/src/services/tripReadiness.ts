import type { BudgetOverview, FlightOption, HotelOption, ItineraryDay, TripSummary, WeatherCondition } from '../types';
import type { DemoOrder } from './payments';

export type ReadinessTab = 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab';
export interface ReadinessItem {
  id: string;
  title: string;
  status: 'ready' | 'review' | 'info';
  summary: string;
  detail: string;
  action: string;
  tab: ReadinessTab;
}
export interface ReadinessInput {
  trip: TripSummary;
  days: ItineraryDay[];
  flights: FlightOption[];
  hotels: HotelOption[];
  nearbyHotels?: HotelOption[];
  weather: Pick<WeatherCondition, 'data_status' | 'dailyForecast'> | null;
  budget: BudgetOverview | null;
  bookings?: Pick<DemoOrder, 'trip_id' | 'status' | 'booking'>[];
  bookingState: 'loading' | 'unavailable' | 'loaded';
}

const usablePrice = (value: number) => Number.isFinite(value) && value > 0;
function bookingNote(input: ReadinessInput, kind: 'flight' | 'hotel', id?: string) {
  if (!id) return 'Review available options or arrange travel separately. Demo booking is optional.';
  if (input.bookingState === 'loading') return 'Checking demo booking status.';
  if (input.bookingState === 'unavailable') return 'Demo booking status unavailable; retry in the travel tab.';
  const matching = input.bookings?.filter(order => order.trip_id === input.trip.id && order.booking?.kind === kind && order.booking.source === 'discovered' && order.booking.option_id === id) || [];
  if (matching.some(order => order.status === 'succeeded')) return 'Booked — Demo. No money charged or real reservation made.';
  if (matching.some(order => order.status === 'pending')) return 'Demo payment pending; check its status before trying again.';
  if (matching.some(order => order.status === 'created')) return 'Demo checkout not completed.';
  if (matching.some(order => order.status === 'failed')) return 'Demo payment failed; nothing charged.';
  return 'Planning choice only; no demo booking confirmed. Demo booking is optional.';
}

function dateStamp(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
}

/** Read-only assessment of saved information. Never grants access or changes a schedule. */
export function buildTripReadiness(input: ReadinessInput): ReadinessItem[] {
  const { trip, days, flights, hotels, nearbyHotels = [], weather, budget } = input;
  const flight = flights.find(option => option.isSelected) || flights[0];
  const hotel = [...hotels, ...nearbyHotels].find(option => option.isSelected) || hotels[0];
  const selections: ReadinessItem[] = [
    { id: 'flight', title: 'Flight', status: flight && usablePrice(flight.pricePerPerson) ? 'ready' : 'review',
      summary: flight ? `${flight.airlineName || flight.airlineCode} ${flight.flightNumber} · planned` : 'No flight option saved',
      detail: `${flight && !usablePrice(flight.pricePerPerson) ? 'Price unavailable. ' : ''}${bookingNote(input, 'flight', flight?.id)}`,
      action: 'Review flights', tab: 'flights-tab' },
    { id: 'hotel', title: 'Hotel', status: hotel && usablePrice(hotel.pricePerNight) ? 'ready' : 'review',
      summary: hotel ? `${hotel.name} · planned` : 'No hotel option saved',
      detail: `${hotel && !usablePrice(hotel.pricePerNight) ? 'Nightly price unavailable. ' : ''}${bookingNote(input, 'hotel', hotel?.id)}`,
      action: 'Review hotels', tab: 'hotels-tab' },
  ];
  const start = dateStamp(trip.startDate), end = dateStamp(trip.endDate);
  const dates: string[] = [];
  if (start !== null && end !== null && end >= start && (end - start) / 86400000 < 366) {
    for (let stamp = start; stamp <= end; stamp += 86400000) dates.push(new Date(stamp).toISOString().slice(0, 10));
  }
  const forecastDates = new Set((weather?.data_status !== 'unavailable' ? weather?.dailyForecast || [] : [])
    .filter(day => dateStamp(day.date) !== null && Number.isFinite(day.tempHigh) && Number.isFinite(day.tempLow))
    .map(day => day.date));
  const covered = dates.filter(date => forecastDates.has(date)).length;
  const forecastComplete = dates.length > 0 && covered === dates.length;
  const weatherItem: ReadinessItem = { id: 'weather', title: 'Trip forecast', status: forecastComplete ? 'ready' : 'review',
    summary: forecastComplete ? 'Available for all trip dates' : covered ? `Available for ${covered} of ${dates.length} trip dates` : 'No complete forecast for these dates',
    detail: 'Check Weather for the latest availability. Forecasts may be unavailable for past dates or dates too far ahead.',
    action: 'Check weather', tab: 'weather-tab' };

  const validBudget = budget && Number.isFinite(budget.totalBudget) && budget.totalBudget > 0 && Number.isFinite(budget.allocatedExpenditure) && budget.allocatedExpenditure >= 0;
  const overBudget = validBudget && budget.allocatedExpenditure > budget.totalBudget;
  const costs: ReadinessItem = { id: 'budget', title: 'Costs', status: validBudget && budget.isComplete && !overBudget ? 'ready' : 'review',
    summary: !validBudget ? 'No usable cost estimate saved' : overBudget ? 'Known costs exceed your trip budget' : budget.isComplete ? 'Saved estimate available' : 'Cost estimate is incomplete',
    detail: budget?.notes || 'Review known costs and any missing food, transport or activity prices. Estimates are not final provider quotes.',
    action: 'Review budget', tab: 'budget-tab' };

  const visits = days.flatMap(day => day.activities).filter(activity => {
    const category = (activity.type || activity.category || '').toLowerCase();
    return !activity.isMealBreak && !/airport|flight|hotel|accommodation|transport|transit|transfer|free.?time|meal.?break/.test(category);
  });
  const closed = visits.filter(activity => activity.operatingStatus?.toUpperCase() === 'CLOSED').length;
  const unknown = visits.filter(activity => activity.operatingStatus?.toUpperCase() === 'UNKNOWN' || !activity.operatingHours?.some(line => line.trim())).length;
  const hours: ReadinessItem = { id: 'hours', title: 'Visit opening hours', status: closed || unknown ? 'review' : 'info',
    summary: closed ? `${closed} scheduled ${closed === 1 ? 'visit' : 'visits'} marked closed` : unknown ? `${unknown} ${unknown === 1 ? 'visit needs' : 'visits need'} hours checked` : visits.length ? 'Hours listed for scheduled visits' : 'No sightseeing or dining visits to check',
    detail: 'Listed hours do not guarantee admission or availability on your travel date. Confirm with the venue before visiting.',
    action: 'Review days & map', tab: 'route-tab' };
  return [...selections, weatherItem, costs, hours];
}
