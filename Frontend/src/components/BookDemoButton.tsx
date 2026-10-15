import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useBookingStatus } from '../hooks/useTripBookings';

export function BookDemoButton({ kind, id, price, onBook, source = 'discovered' }: {
  kind: 'flight' | 'hotel'; id: string; price: number;
  source?: 'discovered' | 'sample';
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const bookings = useBookingStatus();
  const order = bookings?.find(kind, id, source);
  const previous = bookings?.previous.filter(item => item.booking?.kind === kind && item.booking.option_id === id && item.booking.source === source) || [];
  const book = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try { await onBook(kind, id, source); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (bookings?.loading) return <p role="status" className="text-xs text-on-surface-variant">Checking booking status…</p>;
  if (bookings?.error) return <div className="space-y-2 text-xs"><p role="status">Booking status unavailable</p><button type="button" onClick={() => void bookings.refresh()} className="text-primary underline">Retry status check</button><button type="button" onClick={bookings.openSettings} className="ml-3 text-primary underline">API Settings</button></div>;
  if (order && order.status !== 'cancelled') {
    const paid = order.status === 'succeeded';
    const label = paid ? 'Booked — Demo' : order.status === 'pending' ? 'Payment pending' : order.status === 'created' ? 'Checkout not completed' : 'Payment failed — nothing charged';
    const action = paid ? 'View confirmation' : order.status === 'pending' ? 'Check status' : order.status === 'created' ? 'Continue checkout' : 'Try again';
    return <div className="space-y-2" aria-label={`${kind} booking status`}>
      <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${paid ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-primary/10 text-primary'}`}>{paid && <CheckCircle2 className="w-4 h-4" />}{label}</p>
      <p className="text-xs text-on-surface-variant break-all">Reference: {order.id}{paid && kind === 'hotel' ? ` · ${order.booking?.rooms || 1} room(s)` : ''}</p>
      <button type="button" onClick={() => bookings?.openOrder(order.id, paid)} className="rounded-xl px-4 py-2 border border-primary/30 text-primary text-sm font-semibold">{action}</button>
    </div>;
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={busy || !Number.isFinite(price) || price <= 0} onClick={() => void book()} className="rounded-xl px-4 py-2 bg-primary text-on-primary font-semibold text-sm disabled:opacity-50">{busy ? 'Preparing…' : source === 'sample' ? `Try sample ${kind} — Demo` : `Book ${kind} — Demo`}</button>
    {price <= 0 && <span className="text-xs text-on-surface-variant">Price unavailable</span>}
    {previous.length > 0 && <p className="text-xs text-on-surface-variant">Previously booked for different travel details. <button className="text-primary underline" onClick={() => bookings?.openOrder(previous[0].id, true)}>View previous confirmation</button></p>}
  </div>;
}
