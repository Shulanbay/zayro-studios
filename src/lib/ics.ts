/**
 * A minimal iCalendar (.ics) file for one studio session, in studio time.
 * Times are written as UTC instants so every calendar app shows the right
 * local time. Pure.
 */
import { addDays, wallTimeToUtc } from './crm/time';

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escapes text per RFC 5545 (backslash, semicolon, comma, newlines). */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildSessionIcs(args: {
  uid: string;
  title: string;
  description?: string;
  location: string;
  date: string; // YYYY-MM-DD (studio time)
  startTime: string; // HH:MM
  endTime: string;
  now?: Date;
}): string {
  const endDate = args.endTime <= args.startTime ? addDays(args.date, 1) : args.date;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZAYRO Studios//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(args.uid)}@zayro.studio`,
    `DTSTAMP:${stamp(args.now ?? new Date())}`,
    `DTSTART:${stamp(wallTimeToUtc(args.date, args.startTime))}`,
    `DTEND:${stamp(wallTimeToUtc(endDate, args.endTime))}`,
    `SUMMARY:${icsText(args.title)}`,
    `LOCATION:${icsText(args.location)}`,
    ...(args.description ? [`DESCRIPTION:${icsText(args.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
