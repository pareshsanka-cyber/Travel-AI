import { ArrowRight, CheckCircle2, ChevronDown, CircleHelp, ClipboardCheck } from 'lucide-react';
import { useBookingStatus } from '../hooks/useTripBookings';
import { buildTripReadiness, ReadinessInput, ReadinessTab } from '../services/tripReadiness';

type Props = Omit<ReadinessInput, 'bookings' | 'bookingState'> & { onNavigate: (tab: ReadinessTab) => void };

export function TripReadiness({ onNavigate, ...input }: Props) {
  const bookings = useBookingStatus();
  const items = buildTripReadiness({ ...input, bookings: bookings?.current,
    bookingState: !bookings || bookings.error ? 'unavailable' : bookings.loading ? 'loading' : 'loaded' });
  const needsReview = items.filter(item => item.status === 'review').length;
  return <details open className="rounded-xl border border-surface-container-highest bg-surface-container p-4 sm:p-5" aria-label="Trip readiness">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg text-on-surface [&::-webkit-details-marker]:hidden">
      <ClipboardCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
      <h2 className="text-base font-semibold">Trip readiness</h2>
      <span className="text-xs text-on-surface-variant sm:ml-auto">{needsReview ? `${needsReview} ${needsReview === 1 ? 'item' : 'items'} to review` : 'No missing saved details'}</span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-on-surface-variant" />
    </summary>
    <p className="mt-2 text-xs text-on-surface-variant">Review before you travel. Uses saved details and trip weather checked during this visit, not reservation guarantees.</p>
    <ul className="mt-4 grid gap-x-6 sm:grid-cols-2">
      {items.map(item => <li key={item.id} className="min-w-0 border-t border-surface-container-highest py-3" data-readiness-item={item.id}>
        <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          {item.status === 'ready' ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /> : <CircleHelp aria-hidden="true" className="h-4 w-4 shrink-0 text-on-surface-variant" />}
          <h3>{item.title}</h3>
        </div>
        <p className="mt-1 break-words text-sm text-on-surface">{item.summary}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-on-surface-variant">{item.detail}</p>
        <button type="button" onClick={() => onNavigate(item.tab)} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg text-xs font-semibold text-primary">
          {item.action}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </li>)}
    </ul>
  </details>;
}
