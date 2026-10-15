import { ItineraryDay, TripSummary } from '../types';

const escapeCalendar = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const timestamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function localTimeToUtc(date: string, time: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Calendar export needs verified dates and activity times.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let actual = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(format.formatToParts(actual).map(part => [part.type, part.value]));
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    if (displayed === desired) return new Date(actual);
    actual += desired - displayed;
  }
  throw new Error('An activity falls in a daylight-saving time gap. Adjust its time before exporting.');
}

function foldCalendarLine(line: string): string {
  const encoder = new TextEncoder();
  let length = 0, result = '';
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { result += '\r\n '; length = 1; }
    result += character; length += bytes;
  }
  return result;
}

export function buildCalendar(trip: TripSummary, days: ItineraryDay[], now = new Date()): string {
  if (!days.length) throw new Error('Generate an itinerary before exporting.');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TravelAI//Itinerary//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  let count = 0;
  for (const day of days) {
    for (const [index, activity] of day.activities.entries()) {
      const date = day.isoDate || day.date;
      const timezone = activity.timezone || trip.destinationTimezone || 'Asia/Kolkata';
      const start = localTimeToUtc(date, activity.startTime || '', timezone);
      const end = localTimeToUtc(date, activity.endTime || '', timezone);
      if (end <= start) throw new Error(`Invalid visit duration for ${activity.title}.`);
      const uid = `${trip.id}.${activity.id || index}.day${day.dayNumber}@travelai`.replace(/[^a-zA-Z0-9.@_-]/g, '_');
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${timestamp(now)}`,
        `SEQUENCE:${trip.revision || 1}`, `DTSTART:${timestamp(start)}`, `DTEND:${timestamp(end)}`,
        `SUMMARY:${escapeCalendar(activity.title)}`, `LOCATION:${escapeCalendar(activity.location || trip.destination)}`,
        `DESCRIPTION:${escapeCalendar(activity.description || 'Planned visit. Confirm availability before travel.')}`, 'END:VEVENT');
      count++;
    }
  }
  if (!count) throw new Error('There are no scheduled activities to export.');
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}

export function buildItineraryText(trip: TripSummary, days: ItineraryDay[]): string {
  return [trip.title, `${trip.duration} | ${trip.travelersCount} traveler(s)`, `Destination: ${trip.destination}`,
    'TravelAI planning itinerary. Confirm reservations, prices, and operating hours with providers.', '',
    ...days.flatMap(day => [`Day ${day.dayNumber} — ${day.isoDate || day.date}`, ...day.activities.map(activity =>
      `${activity.startTime || activity.time}–${activity.endTime || ''} ${activity.title}${activity.location ? ` (${activity.location})` : ''}`), ''])].join('\n');
}

export function downloadFile(filename: string, content: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
