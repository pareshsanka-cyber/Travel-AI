import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';
import type { ReviewProposal } from '../services/rerouteV2';

export function RerouteReviewDialog({ proposal, busy, error, onConfirm, onClose, returnFocus }: {
  proposal: ReviewProposal; busy: boolean; error: string | null;
  onConfirm: (optionId: string) => void; onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(proposal.options[0]?.id || '');
  const option = proposal.options.find(o => o.id === selected);
  const target = proposal.original_stops.find(s => s.id === proposal.target_activity_id);
  useModalFocus(panel, true, () => { if (!busy) onClose(); }, returnFocus);
  return <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-3 motion-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="adjust-day-title" aria-busy={busy} tabIndex={-1}
      className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-surface-container border border-surface-container-highest shadow-xl motion-dialog" onClick={e => e.stopPropagation()}>
      <header className="p-5 border-b border-surface-container-highest flex justify-between gap-3">
        <div><h2 id="adjust-day-title" className="font-bold text-lg">Adjust your day</h2><p className="text-sm text-on-surface-variant">Day {proposal.day_number} · Review before updating. Your trip stays unchanged until you confirm.</p></div>
        <button type="button" aria-label="Close review" disabled={busy} onClick={onClose} className="p-2 self-start rounded-lg hover:bg-surface-container-highest"><X size={18} /></button>
      </header>
      <div className="p-5 space-y-4">
        <p className="text-sm font-semibold">{proposal.trigger === 'delay' ? 'Running late' : proposal.trigger === 'closed' ? 'Reported closed' : 'Skip / replace'}: {target?.title || 'Selected stop'}{target?.startTime && ` · ${target.startTime}–${target.endTime}`}</p>
        <p className="text-xs text-on-surface-variant">{proposal.origin_location_label}</p>
        {proposal.warnings.map((warning, i) => <p key={i} className="text-sm p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">{warning}</p>)}
        {!proposal.options.length && <p role="status">No safe adjustment fits these commitments. Keep your schedule, or update the itinerary timings first.</p>}
        <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold mb-2">Review options</legend>
          {proposal.options.map(o => <label key={o.id} className={`block p-4 border rounded-xl cursor-pointer ${selected === o.id ? 'border-primary bg-primary/5' : 'border-surface-container-highest'}`}>
            <span className="flex items-start gap-3"><input type="radio" name="adjust-option" value={o.id} checked={selected === o.id} onChange={() => setSelected(o.id)} className="mt-1 accent-primary" />
              <span className="min-w-0"><span className="font-semibold">{o.title}</span>{o.recommended && <span className="ml-2 text-xs text-primary">Recommended</span>}
                <span className="block text-sm text-on-surface-variant mt-1">{o.reason}</span>
                {o.kind !== 'skip_only' && <span className="block text-xs mt-2 text-on-surface-variant">Estimated travel {o.impact.travel_minutes} min · Finish {o.impact.finish_time || 'Unknown'} · {o.impact.opening_hours}</span>}
              </span></span>
          </label>)}
        </fieldset>
        {option && option.kind !== 'skip_only' && <section aria-label="Schedule comparison" className="space-y-3">
          <h3 className="font-semibold">Before and after</h3>
          {option.impact.changed_stops.map(s => <div key={s.id} data-proposal-changed="true" className="flex flex-wrap gap-2 justify-between border-b border-surface-container-highest pb-2 text-sm"><span>{s.title}</span><span className="font-mono tabular-nums">{s.before_start ? `${s.before_start}–${s.before_end}` : 'New stop'} → {s.after_start}–{s.after_end}</span></div>)}
          <p className="text-sm">Day finishes: {option.impact.original_finish || 'Unknown'} → {option.impact.finish_time || 'Unknown'}</p>
          <p className="text-xs text-on-surface-variant">{option.impact.price_difference === null ? 'Price difference unknown. Check prices with the venue before travel.' : `Known price difference: ${new Intl.NumberFormat(undefined, { style: 'currency', currency: option.impact.currency }).format(option.impact.price_difference)}. Other costs may be unknown.`}</p>
          <p className="text-xs text-on-surface-variant">Includes a five-minute transition between flexible visits and ten minutes before fixed appointments.</p>
          <ul className="text-xs text-on-surface-variant space-y-1">{option.travel.map((leg, i) => <li key={i}>{option.proposed_stops.find(s => s.id === leg.to_id)?.title}: {leg.duration_minutes} min · {leg.confidence}</li>)}</ul>
        </section>}
        {error && <p role="alert" className="p-3 rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</p>}
      </div>
      <footer className="p-4 border-t border-surface-container-highest flex flex-col sm:flex-row justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="px-4 py-3 rounded-xl bg-surface-container-highest">Keep current schedule</button>
        <button type="button" disabled={busy || !option} onClick={() => option && onConfirm(option.id)} className="px-4 py-3 rounded-xl bg-primary text-on-primary disabled:opacity-50">{busy ? 'Saving changes…' : 'Confirm changes'}</button>
      </footer>
    </div>
  </div>;
}
