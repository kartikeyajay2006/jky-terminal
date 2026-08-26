import { describe, expect, it } from "vitest";
import {
  GRID_ROWS,
  WEEKDAYS,
  daysInMonth,
  localDay,
  monthGrid,
  monthLabel,
  nextMonth,
  prevMonth,
} from "./calendar";

describe("daysInMonth", () => {
  it("knows the ordinary months", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 8)).toBe(31);
  });

  it("knows a leap year", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("gets the century rule right", () => {
    // 1900 and 2100 are divisible by four and are not leap years; 2000 is.
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe("monthGrid", () => {
  const today = new Date(2026, 7, 27);

  it("is always six full weeks", () => {
    // A grid that changes height makes everything below it jump when you
    // page through the year.
    for (let m = 1; m <= 12; m += 1) {
      expect(monthGrid(2026, m, today)).toHaveLength(GRID_ROWS * WEEKDAYS.length);
    }
  });

  it("starts on a Sunday", () => {
    const first = monthGrid(2026, 8, today)[0];
    expect(new Date(`${first.date}T00:00:00`).getDay()).toBe(0);
  });

  it("contains every day of the month exactly once", () => {
    const grid = monthGrid(2026, 8, today);
    const own = grid.filter((c) => c.inMonth).map((c) => c.day);
    expect(own).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("marks the borrowed days on both sides", () => {
    const grid = monthGrid(2026, 8, today);
    // August 2026 starts on a Saturday, so six days are borrowed in front.
    expect(grid[0].inMonth).toBe(false);
    expect(grid[grid.length - 1].inMonth).toBe(false);
  });

  it("borrows from the previous month, not from nowhere", () => {
    const grid = monthGrid(2026, 8, today);
    expect(grid[0].date.startsWith("2026-07")).toBe(true);
  });

  it("borrows from the next month at the end", () => {
    const grid = monthGrid(2026, 8, today);
    expect(grid[grid.length - 1].date.startsWith("2026-09")).toBe(true);
  });

  it("rolls back into the previous year in January", () => {
    const grid = monthGrid(2026, 1, today);
    expect(grid[0].date.startsWith("2025-12")).toBe(true);
  });

  it("rolls forward into the next year in December", () => {
    const grid = monthGrid(2026, 12, today);
    expect(grid[grid.length - 1].date.startsWith("2027-01")).toBe(true);
  });

  it("handles a month that begins on a Sunday", () => {
    // February 2026 begins on a Sunday: nothing is borrowed in front.
    const grid = monthGrid(2026, 2, today);
    expect(grid[0].inMonth).toBe(true);
    expect(grid[0].day).toBe(1);
  });

  it("includes the twenty-ninth in a leap February", () => {
    const grid = monthGrid(2024, 2, today);
    expect(grid.filter((c) => c.inMonth).map((c) => c.day)).toContain(29);
  });

  it("marks today exactly once when today is on the grid", () => {
    expect(monthGrid(2026, 8, today).filter((c) => c.isToday)).toHaveLength(1);
  });

  it("marks the right day as today", () => {
    const marked = monthGrid(2026, 8, today).find((c) => c.isToday);
    expect(marked?.day).toBe(27);
    expect(marked?.inMonth).toBe(true);
  });

  it("marks no day when today is a long way from this month", () => {
    expect(monthGrid(2020, 3, today).filter((c) => c.isToday)).toHaveLength(0);
  });

  it("still marks today when it is a borrowed day", () => {
    // 1 September 2026 shows in August's trailing days, and it should not
    // lose its marker for being borrowed.
    const grid = monthGrid(2026, 8, new Date(2026, 8, 1));
    const marked = grid.find((c) => c.isToday);
    expect(marked?.inMonth).toBe(false);
    expect(marked?.date).toBe("2026-09-01");
  });

  it("uses the local date, not UTC", () => {
    // localDay via toISOString would shift the day for anyone east or west
    // of Greenwich, putting today's marker on the wrong square.
    expect(localDay(new Date(2026, 7, 27, 23, 30))).toBe("2026-08-27");
    expect(localDay(new Date(2026, 7, 27, 0, 30))).toBe("2026-08-27");
  });
});

describe("paging", () => {
  it("labels a month the way a person reads it", () => {
    expect(monthLabel(2026, 8)).toBe("Aug 2026");
  });

  it("steps forward across the year boundary", () => {
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(nextMonth(2026, 8)).toEqual({ year: 2026, month: 9 });
  });

  it("steps back across the year boundary", () => {
    expect(prevMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(prevMonth(2026, 8)).toEqual({ year: 2026, month: 7 });
  });

  it("returns to where it started after a round trip", () => {
    for (let m = 1; m <= 12; m += 1) {
      const { year, month } = nextMonth(2026, m);
      expect(prevMonth(year, month)).toEqual({ year: 2026, month: m });
    }
  });
});
