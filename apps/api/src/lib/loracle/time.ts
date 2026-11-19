// Days and hours in the Lorer's own zone (their "today", their dawn, a reminder's wall-clock time).

const tzOffsetMs = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
};

/** The instant of a wall-clock time on a day in a zone ("2026-11-21", "18:00", "Atlantic/Reykjavik"). */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = wall - tzOffsetMs(new Date(wall), timeZone);
  const second = wall - tzOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** The Lorer's calendar day (YYYY-MM-DD) in their zone. */
export const localDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The hour the dawn lane promises (phase B): work written down past the soft budget is done by then. */
export const DAWN = '06:00';

/** The Lorer's next dawn: today's 06:00 in their zone if it is still ahead, else tomorrow's. */
export function nextDawn(now: Date, timeZone: string): Date {
  const today = localDay(now, timeZone);
  const dawn = zonedInstant(today, DAWN, timeZone);
  return dawn.getTime() > now.getTime() ? dawn : zonedInstant(addDays(today, 1), DAWN, timeZone);
}
