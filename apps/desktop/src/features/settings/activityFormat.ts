import type { AuditEvent } from "../../platform";

/**
 * Formatting for the activity stream.
 *
 * Pure, and separate from the component, because this is where the fiddly
 * parts live: what a kind is called, which day an entry belongs to, and how a
 * timestamp reads. A component is an awkward place to test any of that.
 */

export interface EventShape {
  /** A single character standing in for the kind, in the left rail. */
  glyph: string;
  /** Lower-case, short: this sits in a monospace column. */
  label: string;
  /** Which token colours the row. */
  tone: "accent" | "muted" | "warn" | "danger";
}

const SHAPES: Record<string, EventShape> = {
  SecretRead: { glyph: "▸", label: "key", tone: "accent" },
  ProviderRequest: { glyph: "↑", label: "request", tone: "muted" },
  ToolCall: { glyph: "▸", label: "tool", tone: "accent" },
  CommandRun: { glyph: "$", label: "ran", tone: "warn" },
  CommandRejected: { glyph: "⊘", label: "declined", tone: "danger" },
};

/** An unrecognised kind still gets a row rather than vanishing from the log. */
const UNKNOWN: EventShape = { glyph: "·", label: "event", tone: "muted" };

export function shapeOf(kind: string): EventShape {
  return SHAPES[kind] ?? UNKNOWN;
}

/**
 * Timestamps are recorded in UTC and read on a wall clock.
 *
 * Everything below converts before it formats. Reading the raw string is
 * close enough to right to look correct and be wrong: an event at
 * `19:29:59Z` happened at ten to one in the morning the next day in Delhi,
 * so slicing the string files it under the wrong day at the wrong time.
 */
function parse(at: string): Date | null {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `00:59:59` — the time it happened where you are. */
export function timeOf(at: string): string {
  const d = parse(at);
  if (!d) return at;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `2026-08-27` — the local date it happened on. */
export function dayOf(at: string): string {
  const d = parse(at);
  if (!d) return at;
  return localDay(d);
}

/**
 * The heading a day gets.
 *
 * "today" and "yesterday" rather than a date, because those are the two you
 * actually look for and a date makes you compute which one it is.
 */
export function dayLabel(day: string, now: Date = new Date()): string {
  if (day === localDay(now)) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday)) return "yesterday";

  return day;
}

export interface DayGroup {
  day: string;
  label: string;
  events: AuditEvent[];
}

/**
 * Group events by day, newest day first and newest event first within it.
 *
 * What just happened is what you came to look at, so it goes at the top rather
 * than at the bottom of a day's worth of scrolling.
 */
export function groupByDay(events: AuditEvent[], now: Date = new Date()): DayGroup[] {
  const byDay = new Map<string, AuditEvent[]>();

  for (const event of events) {
    const day = dayOf(event.at);
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.push(event);
    } else {
      byDay.set(day, [event]);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayEvents]) => ({
      day,
      label: dayLabel(day, now),
      events: [...dayEvents].sort((a, b) => b.at.localeCompare(a.at)),
    }));
}
