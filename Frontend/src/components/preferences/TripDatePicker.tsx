import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { inclusiveDays } from './tripDetailsModel';
import { formatCalendarDate, isCalendarDate, keyboardDate, monthCells, monthStart, shiftMonth } from './calendarModel';

type Target = 'start' | 'end';
interface Props { start: string; end: string; today: string; onChange: (field: 'start_date' | 'end_date', value: string) => void; }
const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-container-highest text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-30 disabled:cursor-not-allowed';

export function TripDatePicker({ start, end, today, onChange }: Props) {
  const { theme } = useTheme();
  const id = useId(), calendar = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null), endButton = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [month, setMonth] = useState(monthStart(today));
  const [focusDate, setFocusDate] = useState(today);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusRequested = useRef(false);
  const scrollRequested = useRef(false);
  const requestFocus = () => { focusRequested.current = true; setFocusRequest(value => value + 1); };
  const minimum = target === 'end' && isCalendarDate(start) && start > today ? start : today;
  const duration = inclusiveDays(start, end);
  const rangeEnd = end;
  const close = (field = target) => {
    setTarget(null);
    (field === 'end' ? endButton : startButton).current?.focus({ preventScroll: true });
  };
  const open = (field: Target) => {
    const min = field === 'end' && isCalendarDate(start) && start > today ? start : today;
    const saved = field === 'start' ? start : end;
    const next = isCalendarDate(saved) && saved >= min ? saved : min;
    setTarget(field); setMonth(monthStart(next)); setFocusDate(next); scrollRequested.current = true; requestFocus();
  };
  useEffect(() => {
    if (!target || !focusRequested.current) return;
    focusRequested.current = false;
    const cell = calendar.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDate}"]`);
    cell?.focus({ preventScroll: true });
    const body = calendar.current?.closest<HTMLElement>('[data-trip-details-scroll]');
    if (body && calendar.current && cell) {
      if (scrollRequested.current || calendar.current.getBoundingClientRect().height <= body.clientHeight - 16) {
        body.scrollTop += calendar.current.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
        scrollRequested.current = false;
      }
      const bounds = body.getBoundingClientRect(), cellBounds = cell.getBoundingClientRect();
      const heading = calendar.current.querySelector<HTMLElement>('[data-calendar-heading]')?.getBoundingClientRect().height || 0;
      if (cellBounds.bottom > bounds.bottom - 8) body.scrollTop += cellBounds.bottom - bounds.bottom + 8;
      else if (cellBounds.top < bounds.top + heading + 8) body.scrollTop -= bounds.top + heading + 8 - cellBounds.top;
    }
  }, [target, month, focusDate, focusRequest]);
  useEffect(() => {
    if (target && focusDate < minimum) {
      setFocusDate(minimum);
      if (month < monthStart(minimum)) setMonth(monthStart(minimum));
    }
  }, [minimum, target, focusDate, month]);
  const select = (date: string) => {
    if (date < minimum || !target) return;
    onChange(target === 'start' ? 'start_date' : 'end_date', date);
    if (target === 'start') {
      // Ask for the end date; never silently rewrite an existing one.
      setTarget('end'); setFocusDate(date); requestFocus();
    } else close('end');
  };
  const navigate = (next: string) => {
    if (!isCalendarDate(next)) return;
    const nextMonth = monthStart(next < minimum ? minimum : next);
    setMonth(nextMonth); setFocusDate(nextMonth < minimum ? minimum : nextMonth);
  };
  const year = Number(month.slice(0, 4));
  const minYear = Number(today.slice(0, 4));
  const years = [...new Set([...Array.from({ length: 16 }, (_, i) => minYear + i), year])].sort((a, b) => a - b);

  return <div onKeyDownCapture={event => {
    if (event.key === 'Escape' && target) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="grid gap-4 sm:grid-cols-2">
      {(['start', 'end'] as const).map(field => <div key={field} className="min-w-0">
        <label htmlFor={`${id}-${field}`} className="text-sm">{field === 'start' ? 'Start date' : 'End date'}</label>
        <div className={`relative mt-1 rounded-xl border bg-surface-container-lowest ${target === field ? 'border-primary ring-1 ring-primary/20' : 'border-surface-container-highest'}`}>
          <input id={`${id}-${field}`} type="text" inputMode="text" autoComplete="off" spellCheck={false}
            placeholder="YYYY-MM-DD" min={field === 'end' && start > today ? start : today} maxLength={10}
            style={{ colorScheme: theme }} value={field === 'start' ? start : end} aria-describedby={`${id}-format`}
            onChange={event => onChange(field === 'start' ? 'start_date' : 'end_date', event.target.value)}
            onKeyDown={event => { if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); open(field); } }}
            className="w-full min-w-0 rounded-xl bg-transparent py-3 pl-3 pr-12 text-sm tabular-nums text-on-surface placeholder:text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" />
          <button ref={field === 'start' ? startButton : endButton} type="button" aria-label={`Open ${field} date calendar`} aria-expanded={target === field} aria-controls={target ? `${id}-calendar` : undefined}
            onClick={() => target === field ? close(field) : open(field)} className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-primary hover:bg-primary/10">
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>)}
    </div>
    <p id={`${id}-format`} className="mt-2 text-xs text-on-surface-variant">Choose on the calendar or type YYYY-MM-DD. New dates must be today or later.</p>
    {target && <div ref={calendar} id={`${id}-calendar`} role="region" aria-label="Travel dates calendar" className="motion-menu mt-3 rounded-2xl border border-primary/20 bg-surface-container-lowest p-3 sm:p-4 shadow-sm">
      <div data-calendar-heading className="sticky top-0 z-10 rounded-t-xl bg-surface-container-lowest pb-2">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-sm font-semibold text-on-surface" aria-live="polite">{target === 'start' ? 'When does your trip begin?' : 'When does your trip end?'}</p>
          <p className="mt-1 text-xs text-on-surface-variant">{isCalendarDate(start) ? `Starts ${formatCalendarDate(start, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Choose a start date'}{duration ? ` · ${duration} ${duration === 1 ? 'day' : 'days'}` : ''}</p>
        </div>
        <button type="button" aria-label="Close calendar" onClick={() => close()} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-highest"><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" disabled={month <= monthStart(minimum)} onClick={() => navigate(shiftMonth(month, -1))} className={iconButton}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        <div className="grid min-w-0 flex-1 items-center gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 items-center justify-center gap-1">
          <select aria-label="Calendar month" style={{ colorScheme: theme }} value={Number(month.slice(5, 7))} onChange={event => navigate(`${year}-${event.target.value.padStart(2, '0')}-01`)} className="min-w-0 rounded-lg bg-surface-container px-2 py-2 text-sm font-semibold text-on-surface">
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1} disabled={year === Number(minimum.slice(0, 4)) && i + 1 < Number(minimum.slice(5, 7))}>{formatCalendarDate(`2030-${String(i + 1).padStart(2, '0')}-01`, { month: 'short' })}</option>)}
          </select>
          <select aria-label="Calendar year" style={{ colorScheme: theme }} value={year} onChange={event => navigate(`${event.target.value}-${month.slice(5, 7)}-01`)} className="rounded-lg bg-surface-container px-1 py-2 text-sm text-on-surface-variant">{years.map(value => <option key={value}>{value}</option>)}</select>
          </div>
          <p className="hidden text-center text-sm font-semibold text-on-surface sm:block">{formatCalendarDate(shiftMonth(month, 1), { month: 'long', year: 'numeric' })}</p>
        </div>
        <button type="button" aria-label="Next month" disabled={!shiftMonth(month, 1)} onClick={() => navigate(shiftMonth(month, 1))} className={iconButton}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
      </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {[month, shiftMonth(month, 1)].map((visibleMonth, index) => {
          const cells = monthCells(visibleMonth), weeks = Math.ceil((cells.map(Boolean).lastIndexOf(true) + 1) / 7);
          return <div key={visibleMonth} className={index ? 'hidden min-w-0 sm:block' : 'min-w-0'}>
          <h3 id={`${id}-month-${index}`} className="sr-only">{formatCalendarDate(visibleMonth, { month: 'long', year: 'numeric' })}</h3>
          <div role="grid" aria-labelledby={`${id}-month-${index}`} aria-multiselectable="true">
            <div role="row" className="mb-1 grid grid-cols-7">{weekdays.map((day, i) => <span role="columnheader" aria-label={weekdayNames[i]} key={day} className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">{day}</span>)}</div>
            {Array.from({ length: weeks }, (_, row) => <div role="row" key={row} className="grid grid-cols-7 py-0.5">
              {cells.slice(row * 7, row * 7 + 7).map((date, col) => {
                if (!date) return <span role="gridcell" key={`empty-${col}`} />;
                const isStart = date === start, isEnd = date === rangeEnd, selected = isStart || isEnd;
                const between = Boolean(isCalendarDate(start) && isCalendarDate(rangeEnd) && rangeEnd >= start && date >= start && date <= rangeEnd);
                return <div role="gridcell" aria-selected={between} key={date} className={`${between ? 'bg-primary/10' : ''} ${isStart ? 'rounded-l-full' : ''} ${isEnd ? 'rounded-r-full' : ''}`}>
                  <button type="button" data-date={date} disabled={date < minimum} tabIndex={date === focusDate ? 0 : -1}
                    aria-label={`${formatCalendarDate(date)}${date === today ? ', today' : ''}${isStart ? ', start date' : ''}${date === end ? ', end date' : ''}`}
                    aria-current={date === today ? 'date' : undefined} onClick={() => select(date)} onFocus={() => setFocusDate(date)}
                    onKeyDown={event => {
                      const next = keyboardDate(date, event.key, event.shiftKey);
                      if (!next || !/^\d{4}-/.test(next)) return;
                      event.preventDefault(); const value = next < minimum ? minimum : next;
                      setFocusDate(value); setMonth(monthStart(value)); requestFocus();
                    }}
                    className={`relative mx-auto flex h-9 w-full max-w-9 items-center justify-center rounded-full text-xs font-medium tabular-nums disabled:cursor-not-allowed disabled:opacity-25 ${selected ? 'bg-primary text-on-primary shadow-sm' : between ? 'text-primary hover:bg-primary/20' : 'text-on-surface hover:bg-surface-container-highest'} ${date === today && !selected ? 'ring-1 ring-inset ring-primary/50' : ''}`}>
                    {Number(date.slice(8))}
                  </button>
                </div>;
              })}
            </div>)}
          </div>
        </div>; })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-surface-container-highest pt-2 text-xs">
          <button type="button" disabled={!start && !end} onClick={() => { onChange('start_date', ''); onChange('end_date', ''); setTarget('start'); setMonth(monthStart(today)); setFocusDate(today); requestFocus(); }} className="rounded-lg px-2 py-1.5 text-on-surface-variant disabled:opacity-30">Clear dates</button>
          <button type="button" onClick={() => { setMonth(monthStart(minimum)); setFocusDate(minimum); requestFocus(); }} className="rounded-lg px-2 py-1.5 font-semibold text-primary">{minimum === today ? 'Jump to today' : 'Jump to start'}</button>
      </div>
      <p className="sr-only">Use arrow keys to move by day or week, Page Up and Page Down to change month, and Escape to close the calendar.</p>
    </div>}
  </div>;
}
