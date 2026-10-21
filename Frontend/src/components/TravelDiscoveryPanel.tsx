import { useContext, useEffect, useRef, useState } from 'react';
import type { TripSummary } from '../types';
import { TravelDiscoveryContext } from '../context/TravelDiscoveryContext';
import { discoveryApi, externalTravelUrl, type DiscoveryStatus, type TripDiscoveryStatus } from '../services/discovery';
import { ApiError, fetchTrip } from '../services/api';
import { SampleDemoBookings } from './SampleDemoBookings';

type Props = {
  kind: 'flight' | 'hotel'; trip?: TripSummary | null; hasPricedOptions: boolean;
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
};
export function TravelDiscoveryPanel({ kind, trip, hasPricedOptions, onBook }: Props) {
  const acceptTrip = useContext(TravelDiscoveryContext);
  const [loaded, setLoaded] = useState<TripDiscoveryStatus | null>(null);
  const [checked, setChecked] = useState<DiscoveryStatus | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const epoch = useRef(0);
  const [busy, setBusy] = useState(false);
  const active = useRef('');
  active.current = `${trip?.id}/${kind}`;
  const inFlight = useRef(false);
  useEffect(() => {
    ++epoch.current;
    setConflict(false);
    setLoaded(null); setChecked(null); setError(''); setBusy(false); inFlight.current = false;
    if (!trip?.id) return;
    const controller = new AbortController();
    discoveryApi.status(trip.id, controller.signal).then(value => {
      if (!controller.signal.aborted && value.trip_id === trip.id) setLoaded(value);
    }).catch(() => { /* Saved metadata and explicit refresh remain available offline. */ });
    return () => { ++epoch.current; controller.abort(); };
  }, [trip?.id, kind]);
  if (!trip) return null;
  const saved = kind === 'flight' ? trip.flightMetadata : trip.hotelMetadata;
  const product = loaded?.trip_id === trip.id ? loaded[kind] : undefined;
  const metadata: DiscoveryStatus = checked || (loaded?.provider?.failure_reason ? loaded.provider : product?.failure_reason ? product : {
    failure_reason: saved?.failureReason, title: saved?.title, message: saved?.message,
  });
  const refresh = async () => {
    if (inFlight.current) return;
    const scope = active.current, requestEpoch = epoch.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await discoveryApi.refresh(trip.id, kind, trip.revision || 1);
      if (active.current !== scope || epoch.current !== requestEpoch) return;
      setChecked(result.availability);
      acceptTrip(result.trip);
    } catch (failure) {
      if (active.current !== scope || epoch.current !== requestEpoch) return;
      setConflict(failure instanceof ApiError && failure.status === 409);
      setError(failure instanceof ApiError && failure.status === 409
        ? `${failure.message} Use Refresh trip before trying again.`
        : failure instanceof Error ? failure.message : 'Unable to check live availability. Please try again.');
    } finally {
      if (active.current === scope && epoch.current === requestEpoch) { inFlight.current = false; setBusy(false); }
    }
  };
  return <div className="space-y-4">
    <section aria-label={`${kind === 'flight' ? 'Flight' : 'Hotel'} live availability`} className="rounded-xl border border-surface-container-highest bg-surface-container p-4 space-y-3">
      <div aria-live="polite"><h3 className="font-semibold">{metadata.title || (hasPricedOptions ? 'Check current live availability' : 'Live results have not been loaded')}</h3>
        <p className="text-sm text-on-surface-variant mt-1">{metadata.message || 'Search using your saved trip details. Existing selections and bookings are preserved.'}</p></div>
      <div className="flex flex-wrap gap-3 items-center">
        <a href={externalTravelUrl(kind, trip)} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm">{kind === 'flight' ? 'Open Google Flights' : 'Search hotels'}</a>
        <button type="button" disabled={busy} aria-busy={busy} onClick={() => void refresh()} className="rounded-lg px-3 py-2 text-sm border border-primary/40 text-primary disabled:opacity-50">{busy ? 'Checking live availability…' : 'Check live availability'}</button>
      </div>
      {checked?.data_status === 'search_results' && <p role="status" className="text-sm text-tertiary">Travel choices updated. Nothing was automatically selected or booked.</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      {conflict && <button type="button" className="text-primary underline text-sm" onClick={() => {
        const id = trip.id;
        void fetchTrip(id).then(value => { if (active.current === `${id}/${kind}`) { acceptTrip(value); setConflict(false); setError(''); } }).catch(failure => setError(failure instanceof Error ? failure.message : 'Unable to refresh the trip.'));
      }}>Refresh trip</button>}
    </section>
    <SampleDemoBookings flight={kind === 'flight' && !hasPricedOptions} hotel={kind === 'hotel' && !hasPricedOptions} onBook={onBook} />
  </div>;
}
