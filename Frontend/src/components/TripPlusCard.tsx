import { Check, LockKeyhole, Sparkles } from 'lucide-react';
import { TripSummary } from '../types';

export function TripPlusCard({ trip, onUpgrade, onBookings }: { trip: TripSummary; onUpgrade: () => void; onBookings: () => void }) {
  return <section aria-label="Trip Plus" className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold flex items-center gap-2 text-sm"><Sparkles className="w-4 h-4 text-primary" />{trip.plusAccess ? 'Trip Plus active' : 'Upgrade this trip'}</h2>
      {trip.plusAccess && <Check className="w-5 h-5 text-primary" aria-label="Active" />}
    </div>
    <p className="text-xs text-on-surface-variant">{trip.plusAccess ? 'Companion Mode, dynamic rerouting, calendar and printable exports are unlocked for this trip.' : 'Trip Plus unlocks Companion Mode, dynamic rerouting, calendar and printable exports. One-time access for this trip.'}</p>
    {!trip.plusAccess && <p className="text-xs flex items-start gap-2 text-on-surface-variant"><LockKeyhole className="w-3.5 h-3.5 shrink-0" />Demo only — no money charged. Flight and hotel costs are separate and are not collected.</p>}
    {trip.plusAccessSource === 'booking' && <p className="text-xs text-primary">Trip Plus active — included with your demo booking.</p>}
    {!trip.plusAccess && <div className="flex flex-wrap gap-2 pt-1"><button type="button" onClick={onBookings} className="rounded-lg bg-primary text-on-primary px-3 py-2 text-xs font-semibold">Book a flight or hotel — Demo</button><button type="button" onClick={onUpgrade} className="rounded-lg border border-primary/30 text-primary px-3 py-2 text-xs">Upgrade only — ₹499 Demo</button></div>}
  </section>;
}
