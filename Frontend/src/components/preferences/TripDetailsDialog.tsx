import { FormEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';

function iso(value?: string) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TripDetailsDialog({ context, onApply, onClose }: {
  context: Record<string, any> | null | undefined;
  onApply: (updates: Record<string, any>) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true, onClose);
  const [fields, setFields] = useState({ origin: context?.origin || '', destination: context?.destination || '',
    start_date: iso(context?.start_date), end_date: iso(context?.end_date), budget: String(context?.budget || ''),
    currency: context?.currency || 'INR', travelers: String(context?.travelers || context?.adults || 1),
    interests: (context?.interests || context?.preferences || []).join?.(', ') || context?.preferences || '' });
  const [error, setError] = useState('');
  const today = iso(new Date().toDateString());
  const update = (name: keyof typeof fields, value: string) => setFields(previous => ({ ...previous, [name]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if ((fields.start_date && fields.start_date < today && fields.start_date !== iso(context?.start_date)) ||
      (fields.end_date && fields.end_date < today && fields.end_date !== iso(context?.end_date))) { setError('Choose today or future dates for new travel dates.'); return; }
    if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) { setError('The end date must be on or after the start date.'); return; }
    if (!Number.isInteger(Number(fields.travelers)) || Number(fields.travelers) < 1 || Number(fields.travelers) > 20) { setError('Choose between 1 and 20 travelers.'); return; }
    if (fields.budget && (!Number.isFinite(Number(fields.budget)) || Number(fields.budget) <= 0)) { setError('Enter a budget greater than zero.'); return; }
    const interests = fields.interests.split(',').map(item => item.trim()).filter(Boolean);
    onApply({ origin: fields.origin.trim(), destination: fields.destination.trim(), start_date: fields.start_date || null,
      end_date: fields.end_date || null, ...(fields.budget ? { budget: Number(fields.budget) } : {}), currency: fields.currency,
      travelers: Number(fields.travelers), ...(Number(fields.travelers) !== Number(context?.travelers) ? { adults: Number(fields.travelers), children: 0, infants: 0 } : {}), interests, preferences: interests,
      ...(fields.start_date && fields.end_date ? { days: Math.round((Date.parse(fields.end_date) - Date.parse(fields.start_date)) / 86400000) + 1 } : {}) });
    onClose();
  };
  const input = 'mt-1 w-full rounded-xl border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 text-sm';
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="trip-details-title" tabIndex={-1} className="relative w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-surface-container shadow-xl">
      <form onSubmit={submit} noValidate className="p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between"><h2 id="trip-details-title" className="text-xl font-semibold">Trip details</h2><button type="button" aria-label="Close trip details" onClick={onClose} className="p-2"><X className="w-5 h-5" /></button></div>
        <p className="text-sm text-on-surface-variant">Set your planning preferences. Your saved itinerary changes only after an accepted request to TravelAI.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">From<input className={input} value={fields.origin} onChange={event => update('origin', event.target.value)} /></label>
          <label className="text-sm">Destination<input className={input} value={fields.destination} onChange={event => update('destination', event.target.value)} /></label>
          <label className="text-sm">Start date<input type="date" min={today} className={input} value={fields.start_date} onChange={event => update('start_date', event.target.value)} /></label>
          <label className="text-sm">End date<input type="date" min={fields.start_date && fields.start_date > today ? fields.start_date : today} className={input} value={fields.end_date} onChange={event => update('end_date', event.target.value)} /></label>
          <label className="text-sm">Budget<input type="number" min="1" className={input} value={fields.budget} onChange={event => update('budget', event.target.value)} /></label>
          <label className="text-sm">Currency<select className={input} value={fields.currency} onChange={event => update('currency', event.target.value)}>{Array.from(new Set(['INR', 'USD', 'EUR', 'GBP', 'AUD', fields.currency])).map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label className="text-sm">Travelers<input type="number" min="1" max="20" className={input} value={fields.travelers} onChange={event => update('travelers', event.target.value)} /></label>
          <label className="text-sm">Interests<input className={input} value={fields.interests} placeholder="Nature, food, history" onChange={event => update('interests', event.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2">Cancel</button><button type="submit" className="rounded-xl bg-primary text-on-primary px-4 py-2 font-semibold">Apply trip details</button></div>
      </form>
    </div>
  </div>, document.body);
}
