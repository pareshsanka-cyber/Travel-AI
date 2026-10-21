import { addDays, isoDate } from './tripDetailsModel';

export const isCalendarDate = (date: string) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && isoDate(date) === date);
export const monthStart = (date: string) => isCalendarDate(date) ? `${date.slice(0, 7)}-01` : '';
export function shiftMonth(date: string, change: number) {
  if (!isCalendarDate(date)) return '';
  const value = new Date(`${date}T00:00:00Z`), day = value.getUTCDate();
  value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + change);
  const last = new Date(value); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  value.setUTCDate(Math.min(day, last.getUTCDate()));
  const result = value.toISOString().slice(0, 10);
  return isCalendarDate(result) ? result : '';
}
export function monthCells(month: string): Array<string | null> {
  if (!isCalendarDate(month)) return [];
  const start = monthStart(month), offset = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i - offset);
    return date.slice(0, 7) === start.slice(0, 7) ? date : null;
  });
}
export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return isCalendarDate(date) ? new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : '';
}
export function keyboardDate(date: string, key: string, shift = false) {
  if (!isCalendarDate(date)) return '';
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (key === 'ArrowLeft') return addDays(date, -1);
  if (key === 'ArrowRight') return addDays(date, 1);
  if (key === 'ArrowUp') return addDays(date, -7);
  if (key === 'ArrowDown') return addDays(date, 7);
  if (key === 'Home') return addDays(date, -weekday);
  if (key === 'End') return addDays(date, 6 - weekday);
  if (key === 'PageUp') return shiftMonth(date, shift ? -12 : -1);
  if (key === 'PageDown') return shiftMonth(date, shift ? 12 : 1);
  return '';
}
