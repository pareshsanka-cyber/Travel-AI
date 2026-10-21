import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useTheme } from '../../context/ThemeContext';
import { TripDatePicker } from './TripDatePicker';
import { POPULAR_ORIGINS, DESTINATIONS, destinationKey, matchingDestinations, BUDGET_PRESETS, INTERESTS, createDraft, localDate, addDays,
  inclusiveDays, interestKey, uniqueInterests, validateDraft, draftUpdates, formatBudget, isoDate, type PlanningContext } from './tripDetailsModel';

const input = 'mt-1 w-full min-w-0 rounded-xl border border-surface-container-highest bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2';
function Choice({ selected, children, onClick, disabled, label }: {
  selected: boolean; children: ReactNode; onClick: () => void; disabled?: boolean; label?: string;
}) {
  return <button type="button" aria-pressed={selected} aria-label={label} disabled={disabled} onClick={onClick}
    className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs text-left transition-colors disabled:opacity-40 ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-surface-container-highest text-on-surface-variant hover:bg-surface-container-highest'}`}>
    <span className="w-3 shrink-0">{selected && <Check className="w-3 h-3" aria-hidden="true" />}</span>{children}
  </button>;
}
export function TripDetailsDialog({ context, onApply, onClose }: {
  context: PlanningContext; onApply: (updates: Record<string, any>) => void; onClose: () => void;
}) {
  const { theme } = useTheme();
  const panel = useRef<HTMLDivElement>(null), interestInput = useRef<HTMLInputElement>(null);
  useModalFocus(panel, true, onClose);
  const [fields, setFields] = useState(() => createDraft(context));
  const [destinationQuery, setDestinationQuery] = useState('');
  const [showAllDestinations, setShowAllDestinations] = useState(false);
  const [customInterest, setCustomInterest] = useState('');
  const [error, setError] = useState('');
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const refresh = () => setToday(localDate());
    const timer = setInterval(refresh, 60000); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const total = fields.adults+fields.children+fields.infants;
  const duration = inclusiveDays(fields.start_date, fields.end_date);
  const update = (name: 'origin' | 'destination' | 'start_date' | 'end_date' | 'budget' | 'currency', value: string) => {
    setFields(previous => ({ ...previous, [name]: value })); setError('');
  };
  const filteredDestinations = matchingDestinations(destinationQuery);
  const selectedDestination = DESTINATIONS.find(d => destinationKey(d.value) === destinationKey(fields.destination) || destinationKey(d.city) === destinationKey(fields.destination));
  const initialDestinations = selectedDestination && !DESTINATIONS.slice(0, 6).includes(selectedDestination)
    ? [...DESTINATIONS.slice(0, 6), selectedDestination] : DESTINATIONS.slice(0, 6);
  const visibleDestinations = destinationQuery.trim() || showAllDestinations ? filteredDestinations : initialDestinations;
  const toggleInterest = (name: string) => setFields(previous => ({ ...previous, interests: previous.interests.some(i => interestKey(i) === interestKey(name))
    ? previous.interests.filter(i => interestKey(i) !== interestKey(name)) : [...previous.interests, name] }));
  const customInterests = fields.interests.filter(value => !INTERESTS.some(i => interestKey(value) === interestKey(i.name)));
  const addInterest = () => {
    if (!customInterest.trim()) return;
    setFields(previous => ({ ...previous, interests: uniqueInterests([...previous.interests, ...customInterest.split(',')]) }));
    setCustomInterest(''); interestInput.current?.focus();
  };
  const step = (name: 'adults' | 'children' | 'infants', change: number) => setFields(previous => {
    const value = previous[name]+change, nextTotal = previous.adults+previous.children+previous.infants+change;
    return value < (name === 'adults' ? 1 : 0) || (change > 0 && nextTotal > 20) ? previous : { ...previous, [name]: value };
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const draft = { ...fields, interests: uniqueInterests([...fields.interests, ...customInterest.split(',')]) };
    const issue = validateDraft(draft, context);
    if (issue) { setError(issue); return; }
    onApply(draftUpdates(draft)); onClose();
  };
  return createPortal(<div data-travelai-overlay className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
    <div className="motion-backdrop absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="trip-details-title" aria-describedby="trip-details-description" tabIndex={-1}
      className="motion-dialog relative w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-2xl bg-surface-container text-on-surface shadow-xl">
      <form onSubmit={submit} noValidate className="flex flex-col min-h-0">
        <header className="shrink-0 p-4 sm:px-6 border-b border-surface-container-highest">
          <div className="flex items-center justify-between gap-3"><h2 id="trip-details-title" className="text-xl font-semibold">Trip details</h2><button type="button" aria-label="Close trip details" onClick={onClose} className="p-2 rounded-lg hover:bg-surface-container-highest"><X className="w-5 h-5" /></button></div>
          <p id="trip-details-description" className="text-sm text-on-surface-variant mt-1">Choose quick options or enter your own. Applying details updates planning preferences; your saved itinerary stays unchanged.</p>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6" data-trip-details-scroll data-testid="trip-details-body">
          <fieldset className="min-w-0 space-y-3"><legend className="font-semibold mb-2">Route</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="min-w-0"><label className="text-sm" htmlFor="trip-origin">From</label><input id="trip-origin" className={input} value={fields.origin} autoComplete="off" placeholder="Enter departure city" onChange={e => update('origin', e.target.value)} />
                <div role="group" aria-label="Popular departure cities" className="flex flex-wrap gap-2 mt-2">{POPULAR_ORIGINS.map(city => <Choice key={city} selected={fields.origin.trim().toLowerCase() === city.toLowerCase()} onClick={() => update('origin', city)}>{city}</Choice>)}</div>
              </div>
              <div className="min-w-0"><label className="text-sm" htmlFor="trip-destination">Destination</label><input id="trip-destination" className={input} value={fields.destination} autoComplete="off" placeholder="Search or enter a destination" aria-describedby="destination-choice-note" onChange={e => { update('destination', e.target.value); setDestinationQuery(e.target.value); }} />
                <p id="destination-choice-note" className="text-xs text-on-surface-variant mt-2">Search cities, countries or regions, or keep your own destination.</p>
                <div role="group" aria-label="Destination suggestions" className="flex flex-wrap gap-2 mt-2">{visibleDestinations.map(d => <Choice key={d.value} label={d.value} selected={selectedDestination?.value === d.value} onClick={() => { update('destination', d.value); setDestinationQuery(d.city); }}>{d.city}<span className="sr-only">, {d.country}</span></Choice>)}</div>
                {!filteredDestinations.length && <p className="text-xs text-on-surface-variant mt-2">No matching quick choice. Your custom destination will be kept. Custom destinations are supported.</p>}
                {!destinationQuery.trim() && <button type="button" aria-expanded={showAllDestinations} onClick={() => setShowAllDestinations(v => !v)} className="text-primary text-xs underline mt-2 p-1">{showAllDestinations ? 'Show fewer destinations' : 'Show all destinations'}</button>}
              </div>
            </div>
          </fieldset>
          <fieldset className="min-w-0"><legend className="font-semibold mb-2">Dates</legend>
            <TripDatePicker start={fields.start_date} end={fields.end_date} today={today} onChange={update} />
            <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Quick dates">
              <Choice selected={fields.start_date === today} onClick={() => update('start_date', localDate())}>Today</Choice>
              <Choice selected={fields.start_date === addDays(today, 1)} onClick={() => update('start_date', addDays(localDate(), 1))}>Tomorrow</Choice>
              {[3, 5, 7].map(days => <Choice key={days} selected={duration === days} disabled={!fields.start_date || isoDate(fields.start_date) !== fields.start_date || fields.start_date < today} onClick={() => update('end_date', addDays(fields.start_date, days-1))}>{days} days</Choice>)}
            </div><p className="text-xs text-on-surface-variant mt-2">{duration ? `${duration} ${duration === 1 ? 'day' : 'days'}, including arrival and departure dates.` : 'Choose a start date to use duration shortcuts.'}</p>
          </fieldset>
          <fieldset className="min-w-0"><legend className="font-semibold mb-2">Budget</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm">Total trip budget<input type="number" min="1" inputMode="decimal" className={input} value={fields.budget} placeholder="Enter your total budget" onChange={e => update('budget', e.target.value)} /></label>
              <div><label htmlFor="trip-currency" className="text-sm">Currency</label><select id="trip-currency" style={{ colorScheme: theme }} className={input} value={fields.currency} onChange={e => update('currency', e.target.value)}>{Array.from(new Set(['INR', 'USD', 'EUR', 'GBP', 'AUD', fields.currency])).map(currency => <option key={currency}>{currency}</option>)}</select></div>
            </div>
            <div role="group" aria-label="Budget presets" className="flex flex-wrap gap-2 mt-3">{(BUDGET_PRESETS[fields.currency] || []).map(amount => <Choice key={`${fields.currency}-${amount}`} selected={fields.budget !== '' && Number(fields.budget) === amount} onClick={() => update('budget', String(amount))}>{formatBudget(amount, fields.currency)}</Choice>)}</div>
            <p className="text-xs text-on-surface-variant mt-2">For all travelers combined. Changing currency keeps your entered number; it does not convert the amount.</p>
          </fieldset>
          <fieldset className="min-w-0"><legend className="font-semibold mb-2">Travelers <span className="text-sm font-normal text-on-surface-variant">- {total} total</span></legend>
            <div className="grid sm:grid-cols-3 gap-3">{([['adults', 'Adults', 'Age 12+'], ['children', 'Children', 'Ages 2-11'], ['infants', 'Infants', 'Under 2']] as const).map(([key, title, subtitle]) => <div key={key} className="rounded-xl border border-surface-container-highest p-3 flex sm:flex-col justify-between gap-3" role="group" aria-label={title}>
              <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-on-surface-variant">{subtitle}</p></div>
              <div className="flex items-center gap-3 justify-between"><button type="button" aria-label={`Decrease ${title.toLowerCase()}`} disabled={fields[key] <= (key === 'adults' ? 1 : 0)} onClick={() => step(key, -1)} className="p-2 rounded-lg border border-surface-container-highest disabled:opacity-40"><Minus size={14} /></button>
                <output aria-label={`${title} count`} className="tabular-nums font-semibold">{fields[key]}</output>
                <button type="button" aria-label={`Increase ${title.toLowerCase()}`} disabled={total >= 20} onClick={() => step(key, 1)} className="p-2 rounded-lg border border-surface-container-highest disabled:opacity-40"><Plus size={14} /></button></div>
            </div>)}</div><p className="text-xs text-on-surface-variant mt-2">At least one adult; up to 20 travelers in total.</p>
          </fieldset>
          <fieldset className="min-w-0"><legend className="font-semibold mb-2">Interests</legend>
            <div role="group" aria-label="Interest choices" className="flex flex-wrap gap-2">{INTERESTS.map(i => <Choice key={i.name} selected={fields.interests.some(v => interestKey(v) === interestKey(i.name))} onClick={() => toggleInterest(i.name)}>{i.name}</Choice>)}</div>
            {!!customInterests.length && <div role="group" aria-label="Custom interests" className="flex flex-wrap gap-2 mt-2">{customInterests.map(value => <Choice key={interestKey(value)} selected label={`Remove ${value}`} onClick={() => { toggleInterest(value); interestInput.current?.focus(); }}><span className="break-words [overflow-wrap:anywhere]">{value}</span><X size={12} aria-hidden="true" /></Choice>)}</div>}
            <div className="flex gap-2 items-end mt-3"><label className="text-sm flex-1 min-w-0" htmlFor="trip-custom-interest">Add your own interest<input id="trip-custom-interest" ref={interestInput} className={input} value={customInterest} placeholder="For example, photography" onChange={e => setCustomInterest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addInterest(); } }} /></label><button type="button" onClick={addInterest} disabled={!customInterest.trim()} className="px-3 py-2.5 rounded-xl border border-primary/30 text-primary text-sm disabled:opacity-40">Add</button></div>
          </fieldset>
        </div>
        <footer className="shrink-0 border-t border-surface-container-highest p-4 sm:px-6">
          {error && <p role="alert" className="text-error text-sm mb-3">{error}</p>}
          <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl hover:bg-surface-container-highest">Cancel</button><button type="submit" className="rounded-xl bg-primary text-on-primary px-4 py-2.5 font-semibold">Apply trip details</button></div>
        </footer>
      </form>
    </div>
  </div>, document.body);
}
