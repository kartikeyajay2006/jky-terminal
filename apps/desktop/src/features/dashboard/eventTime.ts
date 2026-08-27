/**
 * Turning what someone typed into an instant, and back into words.
 *
 * Two separate inputs — a date and a time, both on the local clock — become
 * one UTC instant for storage. Keeping that conversion here means the rules
 * about what counts as a valid moment are testable without a browser.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD` for a date, for prefilling and for `min`. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local `HH:MM`. */
export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A local date and time as the UTC instant the store keeps.
 *
 * Seconds and no milliseconds, which is the shape the backend validates.
 * Returns null rather than an invalid date, so a caller cannot store one by
 * forgetting to check.
 */
export function toInstant(date: string, time: string): string | null {
  if (!date || !time) return null;
  const local = new Date(`${date}T${time}`);
  if (Number.isNaN(local.getTime())) return null;
  return `${local.toISOString().slice(0, 19)}Z`;
}

/**
 * Why this moment cannot be used, or null if it can.
 *
 * A message rather than a boolean: the form shows it, and the reason a date
 * was refused is the only useful thing to say at that point.
 */
export function whyNot(date: string, time: string, now: Date = new Date()): string | null {
  if (!date) return "Choose a date.";
  if (!time) return "Choose a time.";

  const instant = toInstant(date, time);
  if (!instant) return "That is not a real date and time.";

  // A meeting cannot be arranged for a moment that has already gone. The
  // check is against the instant, not the day, so choosing today and a time
  // this morning is caught too — which the day-level check would miss.
  if (new Date(instant).getTime() < now.getTime()) {
    return "That time has already passed. Choose a later one.";
  }
  return null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `Thu 27 Aug 2026, 09:00` — what the two inputs actually add up to.
 *
 * Shown under the form because a date box and a time box side by side do not
 * tell you what you have chosen, and a wrong month is invisible until the
 * event turns up in the wrong place.
 */
export function describe(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` +
    `, ${localTime(d)}`
  );
}

/** How far ahead this is, in words: `in 2 hours`, `in 3 days`. */
export function relative(date: string, time: string, now: Date = new Date()): string {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return "";

  const minutes = Math.round((d.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return "in the past";
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.round(hours / 24);
  if (days < 14) return `in ${days} ${days === 1 ? "day" : "days"}`;

  const weeks = Math.round(days / 7);
  return `in ${weeks} weeks`;
}

/**
 * What the form opens on: the top of the next hour, date included.
 *
 * The date has to roll with the time. Returning only "00:00" at ten past
 * eleven at night leaves the date on today, so the form opens on a moment
 * that has already gone and refuses to submit before the user has touched
 * anything.
 */
export function defaultWhen(now: Date = new Date()): { date: string; time: string } {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return { date: localDate(d), time: localTime(d) };
}
