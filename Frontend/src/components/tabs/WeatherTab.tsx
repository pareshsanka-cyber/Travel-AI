import { useContentFade } from '../../motion/useInteractionMotion';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { WeatherCondition } from '../../types';

type WeatherData = Pick<WeatherCondition, 'summary' | 'data_status' | 'dailyForecast'> & { reason?: string; fetched_at?: string };
interface WeatherTabProps { weather: WeatherCondition | null; destination?: string; tripId?: string; }
export const WeatherTab = ({ weather, destination, tripId }: WeatherTabProps) => {
  const [period, setPeriod] = useState<'trip' | 'upcoming'>('trip');
  const [data, setData] = useState<WeatherData | null>(weather);
  const [loading, setLoading] = useState(Boolean(tripId));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    apiFetch<{ trip_id: string; weather: WeatherData }>(`/api/trips/${encodeURIComponent(tripId)}/weather?period=${period}`, { signal: controller.signal, timeoutMs: 25000 })
      .then(result => {
        if (!result.weather || !Array.isArray(result.weather.dailyForecast)) throw new Error('Weather response was incomplete. Please retry.');
        if (alive && result.trip_id === tripId) setData(result.weather);
      })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Unable to load weather.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [tripId, period, revision]);
  const contentRef = useContentFade(`${tripId}:${period}:${loading ? 'loading' : error ? 'error' : data?.dailyForecast?.length ? 'forecast' : 'unavailable'}:${revision}`);
  const days = data?.dailyForecast || [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{destination || 'Trip'} Weather</h2>
      {tripId && <div className="flex flex-wrap gap-2" aria-label="Weather dates">
        <button type="button" aria-pressed={period === 'trip'} className="rounded-lg border border-primary/30 px-3 py-2 text-sm text-primary" onClick={() => setPeriod('trip')}>Trip dates</button>
        <button type="button" aria-pressed={period === 'upcoming'} className="rounded-lg border border-primary/30 px-3 py-2 text-sm text-primary" onClick={() => setPeriod('upcoming')}>Next 7 days</button>
        <button type="button" disabled={loading} className="rounded-lg bg-primary px-3 py-2 text-sm text-on-primary disabled:opacity-50" onClick={() => setRevision(value => value + 1)}>Refresh weather</button>
      </div>}
    </div>
    {period === 'upcoming' && <p className="text-sm text-primary">Next 7 days at the destination. These dates are separate from your saved trip.</p>}
    <div ref={contentRef} className="min-h-40 space-y-4" aria-busy={loading} data-weather-content>
    {loading ? <p role="status" className="p-6 rounded-xl bg-surface-container">Loading weather from Open-Meteo...</p> : error ? <div role="alert" className="p-6 rounded-xl bg-error-container text-on-error-container"><p>{error}</p><button type="button" className="underline mt-2" onClick={() => setRevision(value => value + 1)}>Retry weather</button></div> : !days.length ? <div className="p-8 rounded-xl bg-surface-container"><h3 className="font-semibold">Forecast unavailable</h3><p className="mt-2 text-on-surface-variant">{data?.summary || 'No daily forecast is saved. Refresh weather to check the provider.'}</p></div> : <>
      <p className="text-sm text-on-surface-variant">{data?.summary}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{days.map(day => <div key={day.date} className="motion-weather-card p-5 rounded-xl bg-surface-container space-y-2">
        <p className="font-semibold">{day.date}</p><p>{day.conditionText}</p>
        <p>High {day.tempHigh == null ? 'Unavailable' : `${day.tempHigh}\u00b0C`} · Low {day.tempLow == null ? 'Unavailable' : `${day.tempLow}\u00b0C`}</p>
        <p>Rain chance: {day.rainChancePercent == null ? 'Unavailable' : `${day.rainChancePercent}%`}</p>
      </div>)}</div>
      {data?.fetched_at && <p className="text-xs text-on-surface-variant">Updated {new Date(data.fetched_at).toLocaleString()} · Source: Open-Meteo</p>}
    </>}
    </div>
  </div>;
};
