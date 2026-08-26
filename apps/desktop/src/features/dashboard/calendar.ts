/**
 * Month-grid arithmetic, kept out of the component.
 *
 * Calendars are a classic source of off-by-one bugs: the leading days of the
 * grid, the trailing ones, February in a century year, and the rollover at
 * either end of December. None of that is testable inside a component, and
 * all of it is testable here.
 */

export interface DayCell {
  /** Local `YYYY-MM-DD`. */
  date: string;
  day: number;
  /** False for the leading and trailing days borrowed from either side. */
  inMonth: boolean;
  isToday: boolean;
}

export const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A fixed six rows, always.
 *
 * A grid that grows to five rows in one month and six in the next makes
 * everything below it jump when you page through the year.
 */
export const GRID_ROWS = 6;
const CELLS = GRID_ROWS * 7;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD`, never `toISOString`, which would shift the day. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `month` is 1-12, the way a person says it. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, which gets the
  // century rule for February right without restating it.
  return new Date(year, month, 0).getDate();
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Six weeks of cells, Sunday first, with the month's own days in the middle
 * and enough of its neighbours on either side to fill the grid.
 */
export function monthGrid(year: number, month: number, today: Date = new Date()): DayCell[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const todayKey = localDay(today);

  const cells: DayCell[] = [];
  for (let i = 0; i < CELLS; i += 1) {
    // Date normalises out-of-range days, so day 0 and day 32 resolve to the
    // neighbouring months without any wrapping arithmetic here.
    const d = new Date(year, month - 1, i - firstWeekday + 1);
    const date = localDay(d);
    cells.push({
      date,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1 && d.getFullYear() === year,
      isToday: date === todayKey,
    });
  }
  return cells;
}
