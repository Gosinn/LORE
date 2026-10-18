// Date helpers. Instants come from the API as ISO strings; calendar dates (chapter
// days) as YYYY-MM-DD. Everything is shown in the viewer's own locale and zone.

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the viewer's zone, YYYY-MM-DD. */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateKey(iso: string): string {
  return todayISO(new Date(iso));
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${todayISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** An all-day event on a given calendar day starts at local midnight. */
export function fromDateInput(value: string): string {
  return new Date(`${value}T00:00`).toISOString();
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = fmt({ month: 'short' });
const monthYearFmt = fmt({ month: 'long', year: 'numeric' });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtMonthShort = (iso: string) => monthFmt.format(new Date(iso));
export const fmtDayNum = (iso: string) => String(new Date(iso).getDate());
export const fmtMonthYear = (d: Date) => monthYearFmt.format(d);
export const fmtLongDay = (d: Date) => longDayFmt.format(d);

function dayLabel(d: Date): string {
  const today = todayISO();
  const key = todayISO(d);
  if (key === today) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === todayISO(tomorrow)) return 'Tomorrow';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === todayISO(yesterday)) return 'Yesterday';
  return dayFmt.format(d);
}

/** "Tomorrow · 18:00", "Sat 14 Dec – Sun 15 Dec", "Fri 3 Jan · All day". */
export function fmtWhen(e: { startsAt: string; endsAt: string | null; allDay: boolean }): string {
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : null;
  const multiDay = end && todayISO(end) !== todayISO(start);
  if (e.allDay) return multiDay ? `${dayLabel(start)} – ${dayLabel(end!)}` : `${dayLabel(start)} · All day`;
  if (multiDay) return `${dayLabel(start)} ${fmtTime(e.startsAt)} – ${dayLabel(end!)}`;
  return `${dayLabel(start)} · ${fmtTime(e.startsAt)}${end ? `–${fmtTime(e.endsAt!)}` : ''}`;
}

const chapterFmt = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const chapterFmtNoYear = fmt({ day: 'numeric', month: 'long' });

/** Calendar dates are parsed as local noon so no zone can shift them a day. */
const civil = (date: string) => new Date(`${date}T12:00:00`);

export function fmtChapterDate(occurredOn: string, endedOn: string | null): string {
  if (!endedOn || endedOn === occurredOn) return chapterFmt.format(civil(occurredOn));
  const sameYear = occurredOn.slice(0, 4) === endedOn.slice(0, 4);
  return `${(sameYear ? chapterFmtNoYear : chapterFmt).format(civil(occurredOn))} – ${chapterFmt.format(civil(endedOn))}`;
}

export const yearOf = (date: string) => date.slice(0, 4);

export function yearsAgo(date: string): number {
  return new Date().getFullYear() - Number(yearOf(date));
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return dayFmt.format(new Date(iso));
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
