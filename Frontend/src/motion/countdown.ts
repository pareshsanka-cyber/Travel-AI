import type { ActivitySegment, ItineraryDay } from '../types';

export interface CountdownTarget { timestamp: number | null; date: string; time: string; zone: string; }

function formatter(zone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}
function parts(format: Intl.DateTimeFormat, timestamp: number) {
  return Object.fromEntries(format.formatToParts(timestamp).map(part => [part.type, part.value]));
}
function wallStamp(format: Intl.DateTimeFormat, timestamp: number) {
  const p = parts(format, timestamp);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** Resolve all possible offsets around this wall time: reject DST gaps AND repeated hours. */
export function uniqueScheduledInstant(date: string, time: string, zone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !zone) return null;
  const desired = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(desired) || new Date(desired).toISOString().slice(0, 10) !== date) return null;
  try {
    const format = formatter(zone), offsets = new Set<number>(), matches = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 6) {
      const sample = desired + hours * 3600000;
      offsets.add(wallStamp(format, sample) - sample);
    }
    for (const offset of offsets) {
      const candidate = desired - offset;
      if (wallStamp(format, candidate) === desired) matches.add(candidate);
    }
    return matches.size === 1 ? [...matches][0] : null;
  } catch { return null; }
}

export function countdownTarget(activity: ActivitySegment, day: Pick<ItineraryDay, 'isoDate'>, explicitTripZone?: string): CountdownTarget {
  const airport = activity.type?.toLowerCase() === 'airport' || activity.category?.toLowerCase() === 'airport' || /airport/i.test(activity.title);
  const date = activity.scheduledDate || day.isoDate || '';
  const time = activity.startTime || '';
  const zone = activity.timezone || (!airport ? explicitTripZone : '') || '';
  return { timestamp: uniqueScheduledInstant(date, time, zone), date, time, zone };
}

export function countdownDisplay(target: CountdownTarget, now: number) {
  if (target.timestamp === null) return { state: 'unavailable', label: 'Countdown unavailable', value: '' } as const;
  const p = parts(formatter(target.zone), now);
  const today = `${p.year}-${p.month}-${p.day}`;
  if (target.date < today) return { state: 'past', label: 'Past itinerary', value: target.date } as const;
  const seconds = Math.ceil((target.timestamp - now) / 1000);
  if (seconds <= 0) return { state: 'passed', label: 'Scheduled start has passed', value: '' } as const;
  if (seconds > 86400) return { state: 'future', label: 'Starts in', value: `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h` } as const;
  const pad = (value: number) => String(value).padStart(2, '0');
  return { state: 'counting', label: 'Starts in', value: `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}` } as const;
}
