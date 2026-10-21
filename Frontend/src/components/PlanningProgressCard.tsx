import { useEffect, useState } from 'react';
import { Check, Clock3, Loader2, AlertCircle } from 'lucide-react';
import type { PlanningProgress } from '../services/planningProgress';
import { planningSteps } from '../services/planningProgressModel';

export function PlanningProgressCard({ progress, checking, onCheck, onDismiss, onRetry, onApiSettings }: {
  progress: PlanningProgress; checking: boolean; onCheck?: () => void; onDismiss?: () => void; onRetry?: () => void; onApiSettings?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const retryAt = Date.parse(progress.recovery?.retry_at || '');
  const wait = Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return;
    const timer = setInterval(() => { const clock = Date.now(); setNow(clock); if (clock >= retryAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const steps = planningSteps(progress);
  const stopped = ['failed', 'interrupted'].includes(progress.status);
  const disconnected = progress.status === 'connection_lost';
  const active = [...steps].reverse().find(step => step.status === 'running');
  const headline = stopped ? 'Request needs attention' : disconnected ? 'Progress check paused'
    : progress.status === 'restoring' ? 'Connecting to your request'
    : progress.status === 'queued' ? 'Waiting to start your request'
    : progress.kind === 'planning' ? active?.label || 'Finalizing your itinerary'
    : progress.stages.analysis?.status === 'running' ? 'Understanding your request' : 'Preparing your response';
  return <section aria-label="Planning progress" className="min-w-0 w-full max-w-xl p-4 rounded-xl bg-surface-container-high border border-primary/15 text-on-surface text-sm">
    <p role="status" className="flex items-center gap-2 font-semibold">
      {stopped || disconnected ? <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0" /> : <Loader2 aria-hidden="true" className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" />}
      {headline}
    </p>
    {progress.error && <p role="alert" className="mt-2 text-xs leading-relaxed text-on-surface-variant">{progress.error}</p>}
    {stopped && progress.recovery?.message && progress.recovery.message !== progress.error && <p className="mt-2 text-xs text-on-surface-variant">{progress.recovery.message}</p>}
    {(stopped || disconnected) && <p className="mt-2 text-xs text-on-surface-variant">Your request details are preserved.{progress.trip_id ? ' An itinerary was saved; open it before planning again.' : ''}</p>}
    {progress.kind === 'planning' && <details className="mt-3">
      <summary className="cursor-pointer text-xs text-primary py-1">View planning steps</summary>
      <ol className="mt-2 space-y-2 text-xs">
        {steps.map(step => <li key={step.id} className="flex items-start gap-2">
          {step.status === 'done' ? <Check aria-hidden="true" className="w-4 h-4 text-primary shrink-0" />
            : step.status === 'warning' || step.status === 'failed' ? <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0" />
            : <Clock3 aria-hidden="true" className="w-4 h-4 shrink-0 opacity-60" />}
          <span>{step.label}<span className="sr-only">: {step.status}</span></span>
        </li>)}
      </ol>
      <ul aria-label="Travel checks" className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
        {(['attractions', 'restaurants', 'flights', 'hotels', 'weather'] as const).map(stage => {
          const saved = progress.stages[stage];
          const label = { attractions: 'Places', restaurants: 'Dining', flights: 'Flights', hotels: 'Hotels', weather: 'Weather' }[stage];
          const state = saved?.status === 'done' ? 'checked' : saved?.status === 'warning' ? 'unavailable' : saved?.status === 'running' ? 'checking' : saved?.status || 'waiting';
          return <li key={stage} className="rounded-lg border border-primary/15 px-2 py-1">{label}: {state}{saved?.note && <span className="block mt-1 max-w-56">{saved.note}</span>}</li>;
        })}
      </ul>
    </details>}
    {stopped && progress.recovery?.retryable && !progress.trip_id && onRetry && <button type="button" onClick={onRetry} disabled={checking || wait > 0} className="mt-3 mr-2 rounded-lg bg-primary text-on-primary px-3 py-2 font-semibold disabled:opacity-50">{wait ? `Retry available in ${wait}s` : 'Retry saved request'}</button>}
    {disconnected && <div className="flex flex-wrap gap-2 mt-3"><button type="button" onClick={onCheck} disabled={checking} className="rounded-lg bg-primary text-on-primary px-3 py-2 font-semibold disabled:opacity-50">{checking ? 'Checking status…' : 'Check status'}</button>{onApiSettings && <button type="button" onClick={onApiSettings} className="rounded-lg border border-primary/30 px-3 py-2 text-primary">API Settings</button>}</div>}
    {stopped && <button type="button" onClick={onDismiss} disabled={checking} className="mt-3 rounded-lg border border-primary/30 text-primary px-3 py-2 font-semibold disabled:opacity-50">{progress.trip_id ? 'View saved trip' : 'Return to planning'}</button>}
    {(stopped || disconnected) && <p className="mt-3 text-xs break-all text-on-surface-variant">Request reference: {progress.request_id}</p>}
    <p className="mt-3 text-xs text-on-surface-variant">{progress.kind === 'planning' ? 'Live planning checks. No bookings or payments are made.' : 'Your request continues if you refresh this page.'}</p>
  </section>;
}
