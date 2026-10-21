/** Curated choices restored from the original preference popovers. */
export const POPULAR_ORIGINS = ['Hyderabad', 'Mumbai', 'New Delhi', 'Bengaluru', 'Chennai', 'Kolkata'];
export const DESTINATIONS = [
  ['Goa', 'India', 'South Asia'], ['Jaipur', 'India', 'South Asia'], ['Kerala', 'India', 'South Asia'],
  ['Ladakh', 'India', 'South Asia'], ['Mumbai', 'India', 'South Asia'], ['New Delhi', 'India', 'South Asia'],
  ['Tokyo', 'Japan', 'East Asia'], ['Kyoto', 'Japan', 'East Asia'], ['Bali', 'Indonesia', 'Southeast Asia'],
  ['Bangkok', 'Thailand', 'Southeast Asia'], ['Singapore', 'Singapore', 'Southeast Asia'],
  ['Dubai', 'United Arab Emirates', 'Middle East'], ['Paris', 'France', 'Europe'], ['Rome', 'Italy', 'Europe'],
  ['London', 'United Kingdom', 'Europe'], ['Barcelona', 'Spain', 'Europe'], ['Santorini', 'Greece', 'Europe'],
  ['Swiss Alps', 'Switzerland', 'Europe'], ['New York', 'United States', 'North America'],
  ['San Francisco', 'United States', 'North America'], ['Sydney', 'Australia', 'Oceania'], ['Cape Town', 'South Africa', 'Africa'],
].map(([city, country, region]) => ({ city, country, region, value: `${city}, ${country}` }));
export const BUDGET_PRESETS: Record<string, number[]> = {
  INR: [30000, 50000, 75000, 100000, 150000, 250000], USD: [1000, 2000, 3500, 5000, 7500, 10000],
  EUR: [1000, 1800, 3000, 4500, 7000, 9000], GBP: [800, 1500, 2500, 4000, 6000, 8000],
  JPY: [150000, 250000, 400000, 600000, 900000, 1200000], AED: [4000, 7000, 12000, 18000, 25000, 35000],
  AUD: [1500, 3000, 5000, 7500, 10000, 15000], CAD: [1500, 2800, 4500, 7000, 9500, 14000], SGD: [1500, 2500, 4000, 6500, 9000, 12000],
};
export const INTERESTS = [
  ['Beaches', 'Beaches'], ['Temples', 'Temples & Heritage'], ['Nature', 'Nature & Parks'], ['Food', 'Food & Gastronomy'],
  ['History', 'History & Museums'], ['Adventure', 'Adventure & Sports'], ['Shopping', 'Shopping & Bazaars'],
  ['Nightlife', 'Nightlife & Lounges'], ['Culture', 'Culture & Arts'], ['Wildlife', 'Wildlife & Safari'],
  ['Luxury', 'Luxury Leisure'], ['Wellness', 'Wellness & Spa'],
].map(([name, previousName]) => ({ name, previousName }));
export interface TripDetailsDraft {
  origin: string; destination: string; start_date: string; end_date: string; budget: string; currency: string;
  adults: number; children: number; infants: number; interests: string[];
}
export type PlanningContext = Record<string, any> | null | undefined;
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function isoDate(value?: string): string {
  if (!value || typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : localDate(date);
}
export function addDays(date: string, days: number) {
  if (!isoDate(date)) return '';
  return new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0, 10);
}
export function inclusiveDays(start: string, end: string) {
  return start && end && isoDate(start) && isoDate(end) && end >= start ? Math.round((Date.parse(end)-Date.parse(start))/86400000)+1 : null;
}
export function interestKey(value: string) {
  const key = value.trim().toLowerCase();
  return INTERESTS.find(i => [i.name.toLowerCase(), i.previousName.toLowerCase()].includes(key))?.name.toLowerCase() || key;
}
export function uniqueInterests(values: string[]) {
  const seen = new Set<string>();
  return values.map(v => v.trim()).filter(v => { const key = interestKey(v); if (!v || seen.has(key)) return false; seen.add(key); return true; });
}
export function createDraft(context: PlanningContext): TripDetailsDraft {
  const count = (value: unknown, fallback: number) => value != null && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const total = Math.max(1, count(context?.travelers, 1));
  const children = count(context?.children, 0), infants = count(context?.infants, 0);
  const adults = count(context?.adults, Math.max(1, total-children-infants));
  const validBreakdown = adults >= 1;
  const values = context?.interests ?? context?.preferences ?? [];
  const interests = Array.isArray(values) ? values.filter(v => typeof v === 'string') : String(values).split(',');
  return { origin: String(context?.origin || ''), destination: String(context?.destination || ''),
    start_date: isoDate(context?.start_date), end_date: isoDate(context?.end_date), budget: String(context?.budget ?? ''),
    currency: context?.currency || 'INR', adults: validBreakdown ? adults : total,
    children: validBreakdown ? children : 0, infants: validBreakdown ? infants : 0, interests: uniqueInterests(interests) };
}
export function validateDraft(fields: TripDetailsDraft, context: PlanningContext, today = localDate()): string {
  if ((fields.start_date && isoDate(fields.start_date) !== fields.start_date) || (fields.end_date && isoDate(fields.end_date) !== fields.end_date)) return 'Enter valid dates using YYYY-MM-DD, or choose them on the calendar.';
  if ((fields.start_date && fields.start_date < today && fields.start_date !== isoDate(context?.start_date)) ||
    (fields.end_date && fields.end_date < today && fields.end_date !== isoDate(context?.end_date))) return 'Choose today or future dates for new travel dates.';
  if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) return 'The end date must be on or after the start date.';
  const counts = [fields.adults, fields.children, fields.infants];
  if (counts.some(n => !Number.isInteger(n) || n < 0) || fields.adults < 1 || counts.reduce((a,b) => a+b, 0) > 20) return 'Choose 1–20 travelers, including at least one adult.';
  if (fields.budget && (!Number.isFinite(Number(fields.budget)) || Number(fields.budget) <= 0)) return 'Enter a budget greater than zero.';
  return '';
}
export function draftUpdates(fields: TripDetailsDraft) {
  const interests = uniqueInterests(fields.interests), days = inclusiveDays(fields.start_date, fields.end_date);
  return { origin: fields.origin.trim(), destination: fields.destination.trim(), start_date: fields.start_date || null,
    end_date: fields.end_date || null, ...(fields.budget ? { budget: Number(fields.budget) } : {}), currency: fields.currency,
    travelers: fields.adults+fields.children+fields.infants, adults: fields.adults, children: fields.children, infants: fields.infants,
    interests, preferences: interests, ...(days !== null ? { days } : {}) };
}
export function formatBudget(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${amount.toLocaleString()} ${currency}`; }
}
