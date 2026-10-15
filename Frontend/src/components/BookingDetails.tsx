import { DemoOrder, formatMoney } from '../services/payments';

export function BookingDetails({ order }: { order: DemoOrder }) {
  const booking = order.booking;
  if (!booking) return null;
  return <section aria-label="Booking details" className="space-y-3">
    <h3 className="font-semibold">{booking.name}{booking.flight_number ? ` · ${booking.flight_number}` : ''}</h3>
    {booking.source === 'sample' && <p className="rounded-lg bg-primary/10 text-primary px-3 py-2 text-sm">Fictional sample choice. Your planned flight, hotel and map are unchanged.</p>}
    <dl className="grid sm:grid-cols-2 gap-3 text-sm">
      {booking.kind === 'flight' ? <>
        <div><dt className="text-on-surface-variant">One-way route</dt><dd>{booking.origin} → {booking.destination}</dd></div>
        <div><dt className="text-on-surface-variant">Departure</dt><dd>{booking.departure_date} · {booking.departure_time || 'Time unavailable'}</dd></div>
        <div><dt className="text-on-surface-variant">Arrival</dt><dd>{booking.arrival_date ? `${booking.arrival_date} · ` : ''}{booking.arrival_time || 'Time unavailable'}</dd></div>
        <div><dt className="text-on-surface-variant">Travelers</dt><dd>{booking.travelers}</dd></div>
        <div><dt className="text-on-surface-variant">Estimate per traveler</dt><dd>{formatMoney(booking.unit_amount, order.currency)}</dd></div>
      </> : <>
        <div><dt className="text-on-surface-variant">Destination</dt><dd>{booking.destination}</dd></div>
        <div><dt className="text-on-surface-variant">Check-in / check-out</dt><dd>{booking.check_in} → {booking.check_out}</dd></div>
        <div><dt className="text-on-surface-variant">Stay</dt><dd>{booking.nights} {booking.nights === 1 ? 'night' : 'nights'} · {booking.rooms} {booking.rooms === 1 ? 'room' : 'rooms'} · {booking.travelers} guests</dd></div>
        <div><dt className="text-on-surface-variant">Estimate per room per night</dt><dd>{formatMoney(booking.unit_amount, order.currency)}</dd></div>
      </>}
    </dl>
    {booking.kind === 'hotel' && <p className="text-xs text-on-surface-variant">Room capacity and availability are not verified. This is a simulated estimate without added taxes or fees.</p>}
    {order.booking_notice && <p role="status" className="rounded-lg bg-surface-container p-3 text-sm">{order.booking_notice}</p>}
  </section>;
}
