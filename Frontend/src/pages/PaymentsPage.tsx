import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { DemoMethod, DemoOrder, DemoOutcome, methodLabels, orderUrl, paymentApi, formatMoney, productLabel } from '../services/payments';
import { BookingDetails } from '../components/BookingDetails';
import { fetchTrip } from '../services/api';
import { TripSummary } from '../types';

const button = 'rounded-xl px-4 py-3 bg-primary text-on-primary font-semibold disabled:opacity-50';
const secondary = 'rounded-xl px-4 py-3 border border-surface-container-highest hover:bg-surface-container-high';
const panel = 'rounded-2xl border border-surface-container-high bg-surface-container-low p-5 sm:p-6';

export function PaymentsPage({ trip, checkoutTripId, onConfirmed, onReturn }: {
  trip: TripSummary | null; checkoutTripId: string | null;
  onConfirmed: (tripId: string) => Promise<boolean>;
  onReturn: (tripId?: string, companion?: boolean, tab?: 'flights-tab' | 'hotels-tab') => Promise<void>;
}) {
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [history, setHistory] = useState<DemoOrder[]>([]);
  const [method, setMethod] = useState<DemoMethod>('upi');
  const [outcome, setOutcome] = useState<DemoOutcome>('success');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingMessage, setPendingMessage] = useState(false);
  const [receipt, setReceipt] = useState<DemoOrder | null>(null);
  const [confirmationView, setConfirmationView] = useState(false);
  const [printing, setPrinting] = useState(false);
  const submission = useRef(false);
  const confirmed = useRef<string | null>(null);
  const mounted = useRef(true);

  const accept = useCallback(async (next: DemoOrder) => {
    if (!mounted.current) return;
    setOrder(next); orderUrl(next.id);
    if (next.status === 'succeeded' && confirmed.current !== next.id) {
      // Access comes from a fresh trip response, never from the selected demo outcome.
      const refreshed = await onConfirmed(next.trip_id);
      if (refreshed) confirmed.current = next.id;
    }
  }, [onConfirmed]);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    setLoading(true);
    const id = new URL(window.location.href).searchParams.get('payment_order');
    const wantsConfirmation = new URL(window.location.href).searchParams.get('payment_view') === 'confirmation';
    const initial = id ? paymentApi.get(id) : checkoutTripId ? paymentApi.create(checkoutTripId) : Promise.resolve(null);
    Promise.all([initial, paymentApi.history()]).then(async ([next, orders]) => {
      if (!alive) return;
      setHistory(orders);
      if (next) await accept(next);
      if (alive && next?.booking && next.status === 'succeeded' && wantsConfirmation) {
        const document = await paymentApi.confirmation(next.id);
        if (alive) { setReceipt(document); setConfirmationView(true); }
      }
    }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; mounted.current = false; };
  }, [checkoutTripId, accept]);

  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    let alive = true;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = setTimeout(() => { if (alive) setPendingMessage(true); }, 30000);
    setPendingMessage(false);
    const poll = async () => {
      try {
        const next = await paymentApi.get(order.id);
        if (!alive) return;
        await accept(next);
        if (next.status !== 'pending') return;
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : 'Status unavailable.'); }
      if (!alive) return;
      if (Date.now() - started >= 30000) setPendingMessage(true);
      else timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { alive = false; clearTimeout(timer); clearTimeout(deadline); };
  }, [order?.id, order?.status, accept]);

  const attempt = async (choice: DemoOutcome) => {
    if (!order || submission.current) return;
    submission.current = true; setBusy(true); setError(''); setReceipt(null);
    try { await accept(await paymentApi.simulate(order.id, method, choice)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to start the demo.'); }
    finally { submission.current = false; setBusy(false); }
  };
  const check = async () => {
    if (!order || submission.current) return;
    submission.current = true; setBusy(true); setError('');
    try { await accept(await paymentApi.get(order.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Status unavailable.'); }
    finally { submission.current = false; setBusy(false); }
  };
  const viewReceipt = async (id: string, confirmation = false) => {
    setBusy(true); setError('');
    try { const next = await (confirmation ? paymentApi.confirmation(id) : paymentApi.receipt(id)); setConfirmationView(confirmation); setOrder(next); orderUrl(next.id); setReceipt(next); const url = new URL(window.location.href); if (confirmation) url.searchParams.set('payment_view', 'confirmation'); else url.searchParams.delete('payment_view'); window.history.replaceState(null, '', url); }
    catch (err) { setError(err instanceof Error ? err.message : 'Receipt unavailable.'); }
    finally { setBusy(false); }
  };
  const open = async (id: string) => {
    setBusy(true); setError(''); setReceipt(null);
    try { await accept(await paymentApi.get(id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Order unavailable.'); }
    finally { setBusy(false); }
  };
  const start = async () => {
    if (!trip || submission.current) return;
    submission.current = true; setBusy(true); setError('');
    try { await accept(await paymentApi.create(trip.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Order unavailable.'); }
    finally { submission.current = false; setBusy(false); }
  };
  const showHistory = async () => {
    setOrder(null); setReceipt(null); orderUrl(null); setBusy(true);
    try { setHistory(await paymentApi.history()); }
    catch (err) { setError(err instanceof Error ? err.message : 'History unavailable.'); }
    finally { setBusy(false); }
  };
  const reprice = async (rooms: number) => {
    if (!order?.booking || submission.current) return;
    submission.current = true; setBusy(true); setError('');
    try {
      const fresh = await fetchTrip(order.trip_id);
      await accept(await paymentApi.book({ trip_id: order.trip_id, kind: order.booking.kind, source: order.booking.source,
        option_id: order.booking.option_id, rooms, expected_revision: fresh.revision || 1 }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to review this booking.'); }
    finally { submission.current = false; setBusy(false); }
  };
  const receiptContent = (item: DemoOrder) => <>
    <h2 className="text-xl font-bold">{confirmationView ? 'Demo booking confirmation' : 'Demo receipt'}</h2>
    <p>{confirmationView ? 'Demo booking successful — no money charged.' : 'Demo payment successful — no money charged.'}</p>
    <dl className="space-y-3 break-words"><div><dt className="text-on-surface-variant">Order reference</dt><dd>{item.id}</dd></div><div><dt>Trip</dt><dd>{item.trip_title}</dd></div><div><dt>Product</dt><dd>{productLabel(item)}</dd></div><div><dt>Simulated amount</dt><dd>{formatMoney(item.amount, item.currency)} {item.currency}</dd></div><div><dt>Demo method</dt><dd>{item.method ? methodLabels[item.method] : 'Demo'}</dd></div><div><dt>Outcome</dt><dd>Successful · {new Date(item.updated_at + (item.updated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}</dd></div></dl>
    <BookingDetails order={item} />
    <p className="text-sm text-on-surface-variant">For demonstration only. This is not a tax invoice or a flight/hotel reservation confirmation.</p>
  </>;

  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
    {printing && receipt && createPortal(<article id="travelai-print-document">{receiptContent(receipt)}</article>, document.body)}
    <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className="flex items-center gap-2 text-sm text-primary" onClick={() => { orderUrl(null); void onReturn(order?.trip_id); }}><ArrowLeft className="w-4 h-4" />Back to itinerary</button><span className="rounded-full bg-primary/10 text-primary px-3 py-2 text-xs font-bold tracking-wide">DEMO — NO REAL MONEY</span></div>
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl sm:text-3xl font-bold">{receipt ? (confirmationView ? 'Your demo confirmation' : 'Your demo receipt') : order ? (order.booking ? (order.status === 'succeeded' ? `${order.booking.kind === 'flight' ? 'Flight' : 'Hotel'} booked successfully — Demo` : `Demo ${order.booking.kind} checkout`) : `Upgrade your ${order.trip_title} trip`) : 'Payments'}</h1>{order && <button type="button" className="text-primary underline text-sm" onClick={() => void showHistory()}>Payment history</button>}</div>
    {error && <div role="alert" className="rounded-xl bg-error-container text-on-error-container p-4">{error} <button type="button" className="underline" onClick={() => order ? void check() : void showHistory()}>Try again</button></div>}
    {loading ? <div role="status" className="flex gap-2"><Loader2 className="w-5 h-5 animate-spin" />Loading demo payments…</div> : receipt ? <section className={`${panel} space-y-5`} aria-label="Demo receipt">{receiptContent(receipt)}<button type="button" className={button} onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 100); }}>Print / save to PDF</button><button type="button" className={`${secondary} ml-2`} onClick={() => { setReceipt(null); const url = new URL(window.location.href); url.searchParams.delete('payment_view'); window.history.replaceState(null, '', url); }}>Back to payment</button></section> : order ? <>
      <p className="text-on-surface-variant">{order.days} {order.days === 1 ? 'day' : 'days'} · {order.travelers} {order.travelers === 1 ? 'traveler' : 'travelers'}</p>
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6 items-start">
        <section className={`${panel} space-y-6`}>
          <h2 className="font-bold text-xl flex gap-2 items-center"><Sparkles className="text-primary" />{productLabel(order)}</h2>
          {order.booking && <>
            <p className="text-sm text-primary">Demo booking — no money charged or real reservation made.</p>
            <BookingDetails order={order} />
            {!['pending', 'succeeded'].includes(order.status) && <div className="flex flex-wrap gap-3 items-center">
              {order.booking.kind === 'hotel' && <label className="text-sm font-medium">Rooms <select aria-label="Rooms" disabled={busy} value={order.booking.rooms || 1} onChange={event => void reprice(Number(event.target.value))} className="ml-2 rounded-lg bg-surface-container border border-surface-container-highest p-2">{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>}
              <button type="button" disabled={busy} className="text-sm text-primary underline" onClick={() => void reprice(order.booking?.rooms || 1)}>Review booking again</button>
            </div>}
            <p className="rounded-xl bg-primary/10 text-primary p-3 text-sm font-semibold">Trip Plus included for this trip — ₹0 extra</p>
          </>}
          <ul className="space-y-3">{['Companion Mode', 'Dynamic rerouting', 'Calendar and printable itinerary exports'].map(feature => <li className="flex gap-2 items-center" key={feature}><CheckCircle2 className="w-5 h-5 text-primary" />{feature}</li>)}</ul>
          <div role="status" aria-live="polite" className="space-y-3">
            {order.status === 'pending' ? <><div className="flex gap-3 items-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /><h3 className="font-semibold">{pendingMessage ? 'Demo confirmation is still pending' : 'Confirming your demo payment'}</h3></div><p className="text-sm text-on-surface-variant">{pendingMessage ? 'No success has been confirmed. You can safely leave and check this order later.' : 'You can refresh or leave this page. Your attempt is saved.'}</p>{pendingMessage && <button disabled={busy} className={button} onClick={() => void check()}>Check status</button>}<button type="button" disabled={busy} className={secondary} onClick={() => void attempt('cancel')}>Cancel demo payment</button></> : order.status === 'succeeded' ? <><div className={order.booking ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3" : "space-y-3"}><CheckCircle2 className="w-8 h-8 text-emerald-500" /><h3 className="font-semibold text-primary">{order.booking ? 'Demo booking successful — no money charged' : 'Demo payment successful — no money charged'}</h3><div className="flex flex-wrap gap-2">{order.booking && <button className={button} onClick={() => { orderUrl(null); void onReturn(order.trip_id, false, order.booking?.kind === 'flight' ? 'flights-tab' : 'hotels-tab'); }}>{order.booking.kind === 'flight' ? 'View booked flight' : 'View booked hotel'}</button>}<button className={order.booking ? secondary : button} onClick={() => { orderUrl(null); void onReturn(order.trip_id, true); }}>Open Companion Mode</button><button className={secondary} onClick={() => { orderUrl(null); void onReturn(order.trip_id); }}>{order.booking ? 'Return to trip' : 'Return to itinerary'}</button><button disabled={busy} className={secondary} onClick={() => void viewReceipt(order.id, Boolean(order.booking))}>{order.booking ? 'View demo confirmation' : 'View receipt'}</button></div>{order.booking && <p className="text-xs text-on-surface-variant break-all">Booking reference: {order.id} · No money charged or real reservation made.</p>}</div></> : <>
              {order.status === 'failed' && <p className="rounded-xl bg-error-container text-on-error-container p-3">The demo attempt was intentionally set to fail. No money was charged. Choose an outcome below and try again.</p>}
              {order.status === 'cancelled' && <p className="text-on-surface-variant">Demo payment cancelled. This attempt has not granted access. You can try again.</p>}
              <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold mb-3">Choose a demo payment method</legend><div className="flex flex-wrap gap-2">{(Object.keys(methodLabels) as DemoMethod[]).map(key => <label key={key} className={`${secondary} cursor-pointer flex items-center gap-2 ${method === key ? 'border-primary bg-primary/10' : ''}`}><input type="radio" name="demo-method" value={key} checked={method === key} onChange={() => setMethod(key)} />{methodLabels[key]}</label>)}</div></fieldset>
              <div className="rounded-xl bg-surface-container p-4 space-y-2"><h3 className="font-semibold">Demo {methodLabels[method]} selected</h3><p className="text-sm text-on-surface-variant">No bank account, QR scanning, PIN, card number, or OTP is required. This selection changes the presentation only; no bank is contacted.</p></div>
              <fieldset disabled={busy} className="space-y-2"><legend className="font-semibold mb-2 text-sm">Demo controls</legend><div className="flex flex-wrap gap-3 text-sm">{([{ value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' }, { value: 'delayed', label: 'Delayed confirmation' }] as const).map(item => <label className="flex items-center gap-2 cursor-pointer" key={item.value}><input type="radio" name="demo-outcome" checked={outcome === item.value} onChange={() => setOutcome(item.value)} />{item.label}</label>)}</div></fieldset>
              <div className="sticky bottom-0 bg-surface-container-low pt-3 pb-1 flex flex-wrap gap-2"><button type="button" disabled={busy} className={`${button} flex-1`} onClick={() => void attempt(outcome)}>{busy ? 'Starting demo…' : order.status === 'failed' ? `Try again — ${formatMoney(order.amount, order.currency)} Demo` : `Pay ${formatMoney(order.amount, order.currency)} — Demo`}</button><button type="button" disabled={busy} className={secondary} onClick={() => void attempt('cancel')}>Cancel</button></div>
            </>}
          </div>
        </section>
        <aside className={`${panel} space-y-4`} aria-label="Order summary"><h2 className="font-bold text-lg">Order summary</h2><div className="flex justify-between"><span>{productLabel(order)}</span><span>{formatMoney(order.amount, order.currency)}</span></div><div className="flex justify-between border-t border-surface-container-high pt-4 text-lg font-bold"><span>Total</span><span>{formatMoney(order.amount, order.currency)}</span></div><p className="text-sm text-on-surface-variant">{order.booking ? 'Simulated estimate. Trip Plus is included at no extra charge. This checkout creates no real reservation.' : 'One-time fee for this trip. Changes to the itinerary do not require another purchase.'}</p><p className="text-sm text-on-surface-variant">{order.booking ? 'No added taxes or fees. Confirm actual travel arrangements with the provider.' : 'Flight and hotel costs are not collected. Basic planning, maps, chat, weather, budget viewing and text sharing remain free.'}</p><p className="text-sm text-primary flex gap-2"><ShieldCheck className="w-5 h-5 shrink-0" />Simulated {order.currency} payment. No money leaves your account.</p></aside>
      </div>
    </> : <section className={`${panel} space-y-4`}><h2 className="font-bold text-xl">Payment history</h2>{trip && !trip.plusAccess && <button type="button" disabled={busy} className={button} onClick={() => void start()}>Upgrade {trip.destination} — ₹499 Demo</button>}{history.length === 0 ? <p className="text-on-surface-variant">No demo payments yet. Create or open a trip in Planner Studio to try Trip Plus.</p> : <ul className="divide-y divide-surface-container-high">{history.map(item => <li key={item.id} className="py-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{item.trip_title} · {productLabel(item)}</p><p className="text-sm text-on-surface-variant">{formatMoney(item.amount, item.currency)} · {item.status} · Demo</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} className={secondary} onClick={() => void open(item.id)}>Open order</button>{item.status === 'succeeded' && <button disabled={busy} className={secondary} onClick={() => void viewReceipt(item.id)}>View demo receipt</button>}{item.status === 'succeeded' && item.booking && <button disabled={busy} className={secondary} onClick={() => void viewReceipt(item.id, true)}>View demo confirmation</button>}</div></li>)}</ul>}</section>}
  </div>;
}
