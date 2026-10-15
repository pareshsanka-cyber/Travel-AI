import { useContentFade } from '../motion/useInteractionMotion';
import React, { useEffect, useState } from 'react';
import { TripPlusCard } from '../components/TripPlusCard';
import { BookDemoButton } from '../components/BookDemoButton';
import { DemoOrder, formatMoney, paymentApi, productLabel } from '../services/payments';
import { TripSummary, FlightOption, HotelOption } from '../types';

interface BookingsDeskPageProps {
  onUpgrade: () => void;
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
  onOpenOrder: (id: string) => void;
  trip: TripSummary | null; flights: FlightOption[]; hotels: HotelOption[];
  onGoToStudio: () => void; onNavigateToItineraryHub?: () => void;
}
export const BookingsDeskPage: React.FC<BookingsDeskPageProps> = ({ trip, flights, hotels, onGoToStudio, onUpgrade, onBook, onOpenOrder }) => {
  const flight = flights.find(f => f.isSelected);
  const hotel = hotels.find(h => h.isSelected);
  const selectionRef = useContentFade(`${trip?.id}:${flight?.id}:${hotel?.id}`);
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    paymentApi.bookings().then(result => { if (alive) setOrders(result.filter(item => item.trip_id === trip?.id)); })
      .catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [trip?.id]);
  const sampleFlight = !flights.some(item => item.pricePerPerson > 0);
  const sampleHotel = !hotels.some(item => item.pricePerNight > 0);
  return <div className="p-6 lg:p-8 space-y-6">
    <h1 className="text-2xl font-bold">Travel Selections</h1>
    <p className="text-sm text-primary">Demo booking — no money charged or real reservation made.</p>
    <p className="text-on-surface-variant">Compare and save options for {trip?.title || 'your trip'}. Selections do not reserve tickets, rooms, or transfers. Complete reservations with the provider.</p>
    <div ref={selectionRef} className="grid md:grid-cols-2 gap-6">
      <section className="p-6 rounded-xl bg-surface-container space-y-3">
        <h2 className="font-semibold">Selected flight</h2>
        {flight ? <><p>{flight.airlineName || flight.airlineCode} ? {flight.flightNumber}</p><p>{flight.departureTime} ? {flight.arrivalTime}</p>
          <p>Estimated price per person: {flight.currency} {flight.pricePerPerson.toLocaleString()}</p>
          <BookDemoButton kind="flight" id={flight.id} price={flight.pricePerPerson} onBook={onBook} />
          {(flight.googleFlightsUrl || flight.bookingUrl) && <a className="text-primary underline" href={flight.googleFlightsUrl || flight.bookingUrl} target="_blank" rel="noopener noreferrer">Check availability with provider</a>}
        </> : <p>No flight selected. Choose an option in Planner Studio.</p>}
      </section>
      <section className="p-6 rounded-xl bg-surface-container space-y-3">
        <h2 className="font-semibold">Selected accommodation</h2>
        {hotel ? <><p>{hotel.name}</p><p>{hotel.location}</p><p>{hotel.pricePerNight > 0 ? `Estimated per room per night: ${formatMoney(hotel.pricePerNight * 100, hotel.currency || 'INR')}` : 'Price unavailable'}</p><BookDemoButton kind="hotel" id={hotel.id} price={hotel.pricePerNight} onBook={onBook} /><p>Contact the property to confirm availability and price.</p></> : <p>No accommodation selected. Choose an option in Planner Studio.</p>}
      </section>
    </div>
    {trip && (sampleFlight || sampleHotel) && <section className="p-5 sm:p-6 rounded-2xl border border-primary/25 bg-primary/5 space-y-4" aria-label="Sample demo bookings"><h2 className="font-semibold">Try sample demo bookings</h2><p className="text-sm text-on-surface-variant">Priced search results are unavailable. These choices are fictional and match your trip dates. They do not replace your travel selections or map locations.</p><div className="grid sm:grid-cols-2 gap-4">{sampleFlight && <div className="rounded-xl bg-surface-container p-4 space-y-3"><h3 className="font-semibold">Sample demo airline</h3><p className="text-sm">One-way flight · ₹5,000 per traveler · Fictional</p><BookDemoButton kind="flight" source="sample" id="sample-flight" price={5000} onBook={onBook} /></div>}{sampleHotel && <div className="rounded-xl bg-surface-container p-4 space-y-3"><h3 className="font-semibold">Sample demo hotel</h3><p className="text-sm">₹2,500 per room per night · Fictional</p><BookDemoButton kind="hotel" source="sample" id="sample-hotel" price={2500} onBook={onBook} /></div>}</div></section>}
    {trip && <TripPlusCard trip={trip} onUpgrade={onUpgrade} onBookings={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />}
    <section className="p-5 sm:p-6 rounded-2xl bg-surface-container space-y-4"><h2 className="font-semibold">My demo bookings</h2>{error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading demo bookings…</p> : !orders.length ? <p className="text-sm text-on-surface-variant">No demo bookings for this trip yet. Selecting an option does not create a booking.</p> : <ul className="divide-y divide-surface-container-high">{orders.map(order => <li key={order.id} className="py-4 flex flex-wrap justify-between items-center gap-3"><div><p className="font-medium">{order.booking?.name} · {productLabel(order)}</p><p className="text-sm text-on-surface-variant">{formatMoney(order.amount, order.currency)} · {order.status}{order.booking?.source === 'sample' ? ' · Fictional sample' : ''}</p></div><button className="rounded-lg border border-primary/30 px-3 py-2 text-primary text-sm" onClick={() => onOpenOrder(order.id)}>{order.status === 'succeeded' ? 'View demo booking' : 'Open demo order'}</button></li>)}</ul>}</section>
    <button className="px-4 py-2 rounded-lg bg-primary text-on-primary" onClick={onGoToStudio}>Open Planner Studio</button>
  </div>;
};
