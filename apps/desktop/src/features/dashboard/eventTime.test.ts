import { describe as group, expect, it } from "vitest";
import {
  defaultTimeFor,
  defaultWhen,
  describe,
  localDate,
  localTime,
  relative,
  toInstant,
  whyNot,
} from "./eventTime";

const now = new Date(2026, 7, 27, 12, 0, 0);

group("toInstant", () => {
  it("turns a local date and time into a UTC instant", () => {
    // The exact instant depends on the runner's zone, so this checks the
    // shape the backend validates and that it round-trips to the same local
    // wall-clock time.
    const iso = toInstant("2026-08-27", "09:00")!;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(localTime(new Date(iso))).toBe("09:00");
    expect(localDate(new Date(iso))).toBe("2026-08-27");
  });

  it("carries no milliseconds", () => {
    // The Rust side rejects anything but seconds precision.
    expect(toInstant("2026-08-27", "09:00")).not.toContain(".");
  });

  it("refuses rather than inventing a date", () => {
    expect(toInstant("", "09:00")).toBeNull();
    expect(toInstant("2026-08-27", "")).toBeNull();
    expect(toInstant("not-a-date", "09:00")).toBeNull();
  });
});

group("whyNot", () => {
  it("accepts a moment still to come", () => {
    expect(whyNot("2026-08-28", "09:00", now)).toBeNull();
  });

  it("refuses a day that has gone", () => {
    // Arranging a meeting for yesterday is the thing this exists to stop.
    expect(whyNot("2026-08-26", "09:00", now)).toMatch(/passed/i);
  });

  it("refuses a time earlier today", () => {
    // The check that a day-level comparison would miss.
    expect(whyNot("2026-08-27", "09:00", now)).toMatch(/passed/i);
  });

  it("accepts a later time today", () => {
    expect(whyNot("2026-08-27", "17:00", now)).toBeNull();
  });

  it("asks for a date when there is none", () => {
    expect(whyNot("", "09:00", now)).toMatch(/date/i);
  });

  it("asks for a time when there is none", () => {
    expect(whyNot("2026-08-28", "", now)).toMatch(/time/i);
  });

  it("says so when the two do not make a real moment", () => {
    expect(whyNot("nonsense", "09:00", now)).toMatch(/not a real/i);
  });
});

group("describe", () => {
  it("spells out what the two boxes add up to", () => {
    // A date box and a time box side by side do not tell you what you chose,
    // and a wrong month is invisible until the event turns up in the wrong
    // place.
    expect(describe("2026-08-27", "09:00")).toBe("Thu 27 Aug 2026, 09:00");
  });

  it("gets the weekday right across a month boundary", () => {
    expect(describe("2026-09-01", "12:00")).toBe("Tue 1 Sep 2026, 12:00");
  });

  it("shows a dash rather than Invalid Date", () => {
    expect(describe("", "")).toBe("—");
  });
});

group("relative", () => {
  it("counts minutes for something imminent", () => {
    expect(relative("2026-08-27", "12:30", now)).toBe("in 30 min");
  });

  it("counts hours within a day", () => {
    expect(relative("2026-08-27", "15:00", now)).toBe("in 3 hours");
    expect(relative("2026-08-27", "13:00", now)).toBe("in 1 hour");
  });

  it("counts days beyond that", () => {
    expect(relative("2026-08-30", "12:00", now)).toBe("in 3 days");
    expect(relative("2026-08-28", "12:00", now)).toBe("in 1 day");
  });

  it("counts weeks for something distant", () => {
    expect(relative("2026-10-01", "12:00", now)).toMatch(/weeks/);
  });

  it("says plainly when it is behind you", () => {
    expect(relative("2026-08-26", "12:00", now)).toBe("in the past");
  });
});

group("localDate and localTime", () => {
  it("use the local clock, not UTC", () => {
    // toISOString would shift the date for anyone east or west of Greenwich,
    // so today's prefill would be the wrong day.
    expect(localDate(new Date(2026, 7, 27, 23, 45))).toBe("2026-08-27");
    expect(localDate(new Date(2026, 7, 27, 0, 15))).toBe("2026-08-27");
    expect(localTime(new Date(2026, 7, 27, 9, 5))).toBe("09:05");
  });
});

group("defaultWhen", () => {
  it("opens on the top of the next hour", () => {
    expect(defaultWhen(new Date(2026, 7, 27, 14, 37))).toEqual({
      date: "2026-08-27",
      time: "15:00",
    });
  });

  it("rolls the date over midnight, not just the time", () => {
    // Returning only "00:00" left the date on today, so late in the evening
    // the form opened on a moment that had already gone and refused to
    // submit before the user had touched anything.
    expect(defaultWhen(new Date(2026, 7, 27, 23, 10))).toEqual({
      date: "2026-08-28",
      time: "00:00",
    });
  });

  it("rolls across a month boundary", () => {
    expect(defaultWhen(new Date(2026, 7, 31, 23, 30))).toEqual({
      date: "2026-09-01",
      time: "00:00",
    });
  });

  it("always opens on a moment that is still to come", () => {
    // The property, checked around the whole clock rather than at one time.
    for (let h = 0; h < 24; h += 1) {
      const now = new Date(2026, 7, 27, h, 45);
      const { date, time } = defaultWhen(now);
      expect(whyNot(date, time, now), `at ${h}:45`).toBeNull();
    }
  });
});

group("defaultTimeFor", () => {
  it("opens on the next hour during the day", () => {
    expect(defaultTimeFor("2026-08-27", new Date(2026, 7, 27, 14, 37))).toBe("15:00");
  });

  it("offers a plain morning slot for a future day", () => {
    // A better guess for a day three weeks out than "an hour from now".
    expect(defaultTimeFor("2026-09-20", new Date(2026, 7, 27, 14, 37))).toBe("09:00");
  });

  it("does not strand today's form on a time that has gone", () => {
    // The bug this exists for: at ten to midnight the top of the next hour
    // belongs to tomorrow, and the calendar owns the date. Pinning that time
    // onto today opened the form on a moment already past, with the Add
    // button dead before anything was typed.
    const late = new Date(2026, 7, 27, 23, 50);
    const time = defaultTimeFor("2026-08-27", late);
    expect(whyNot("2026-08-27", time, late)).toBeNull();
  });

  it("offers the next minute when no whole hour is left in the day", () => {
    expect(defaultTimeFor("2026-08-27", new Date(2026, 7, 27, 23, 12))).toBe("23:13");
  });

  it("never rolls past the end of the day it was asked about", () => {
    expect(defaultTimeFor("2026-08-27", new Date(2026, 7, 27, 23, 59, 30))).toBe("23:59");
  });

  it("gives today a usable time at every minute of the last hour", () => {
    // The property that actually matters, checked across the window where
    // the old behaviour broke.
    for (let m = 0; m < 60; m += 1) {
      const now = new Date(2026, 7, 27, 23, m);
      const time = defaultTimeFor("2026-08-27", now);
      expect(whyNot("2026-08-27", time, now), `at 23:${m}`).toBeNull();
    }
  });

  it("gives today a usable time at every hour of the clock", () => {
    for (let h = 0; h < 24; h += 1) {
      const now = new Date(2026, 7, 27, h, 45);
      const time = defaultTimeFor("2026-08-27", now);
      expect(whyNot("2026-08-27", time, now), `at ${h}:45`).toBeNull();
    }
  });
});
