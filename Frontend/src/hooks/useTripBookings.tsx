import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DemoOrder, paymentApi, TripBookingStatus } from '../services/payments';

export function useTripBookings(tripId: string | undefined, refreshKey: string) {
  const [data, setData] = useState<TripBookingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const errorTrip = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const currentId = useRef(tripId);
  currentId.current = tripId;
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!tripId) { setData(null); setLoading(false); setError(''); return null; }
    setLoading(true); setError(''); errorTrip.current = undefined;
    try {
      const next = await paymentApi.status(tripId);
      if (!Array.isArray(next?.current) || !Array.isArray(next?.previous)) throw new Error('Booking status is unavailable. Retry or check API Settings.');
      if (request !== sequence.current || currentId.current !== tripId) return null;
      setData(next); return next;
    } catch (err) {
      if (request === sequence.current && currentId.current === tripId) {
        errorTrip.current = tripId;
        setData(null); setError(err instanceof Error ? err.message : 'Unable to check booking status.');
      }
      return null;
    } finally { if (request === sequence.current && currentId.current === tripId) setLoading(false); }
  }, [tripId]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { ++sequence.current; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh, refreshKey]);
  const valid = Boolean(tripId && data?.trip_id === tripId);
  const currentError = errorTrip.current === tripId ? error : '';
  return { loading: loading || Boolean(tripId && !valid && !currentError), error: currentError,
    current: valid ? data!.current : [], previous: valid ? data!.previous : [], refresh,
    find: (kind: string, id: string, source = 'discovered'): DemoOrder | undefined => valid ? data!.current.find(order => order.booking?.kind === kind && order.booking.option_id === id && order.booking.source === source) : undefined };
}

export type TripBookingsModel = ReturnType<typeof useTripBookings> & { openOrder: (id: string, confirmation?: boolean) => void; openSettings: () => void };
export const TripBookingsContext = createContext<TripBookingsModel | null>(null);
export const useBookingStatus = () => useContext(TripBookingsContext);
