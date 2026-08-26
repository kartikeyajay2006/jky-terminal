import { describe, expect, it } from "vitest";
import {
  byTimeOfDay,
  clockFromHhMm,
  clockTime,
  eventsOn,
  isReadable,
  localDayOf,
  longDate,
  past,
  upcoming,
} from "./upcoming";
import type { Event, Reminder } from "../../platform";

const at = (d: Date, title = "e"): Event => ({
  id: `${title}-${d.getTime()}`,
  title,
  starts_at: d.toISOString(),
  colour: "cyan",
  alert_minutes_before: null,
});

const now = new Date(2026, 7, 27, 12, 0, 0);

describe("upcoming", () => {
  it("returns nothing for nothing", () => {
    expect(upcoming([], now)).toEqual([]);
  });

  it("leaves out what has already happened", () => {
    const events = [at(new Date(2026, 7, 26, 10)), at(new Date(2026, 7, 28, 10))];
    expect(upcoming(events, now)).toHaveLength(1);
  });

  it("puts the soonest first", () => {
    const events = [
      at(new Date(2026, 8, 5, 16), "later"),
      at(new Date(2026, 7, 28, 10), "sooner"),
    ];
    expect(upcoming(events, now).map((e) => e.title)).toEqual(["sooner", "later"]);
  });

  it("keeps an event starting this very minute", () => {
    // Dropping it the instant the clock ticks past is how someone misses the
    // meeting they opened the dashboard to check.
    expect(upcoming([at(now, "now")], now)).toHaveLength(1);
  });

  it("takes only as many as asked for, and the soonest ones", () => {
    const events = [
      at(new Date(2026, 8, 5), "third"),
      at(new Date(2026, 7, 28), "first"),
      at(new Date(2026, 7, 30), "second"),
    ];
    expect(upcoming(events, now, 2).map((e) => e.title)).toEqual(["first", "second"]);
  });

  it("skips an unreadable timestamp instead of crashing", () => {
    // A hand-edited events.json must not take the dashboard down.
    const broken: Event = { ...at(new Date()), starts_at: "sometime next week" };
    expect(() => upcoming([broken, at(new Date(2026, 7, 28))], now)).not.toThrow();
    expect(upcoming([broken, at(new Date(2026, 7, 28))], now)).toHaveLength(1);
  });

  it("does not reorder the caller's array", () => {
    const events = [at(new Date(2026, 8, 5), "b"), at(new Date(2026, 7, 28), "a")];
    const before = events.map((e) => e.title);
    upcoming(events, now);
    expect(events.map((e) => e.title)).toEqual(before);
  });
});

describe("past", () => {
  it("is the other half, most recent first", () => {
    const events = [
      at(new Date(2026, 7, 20, 9), "older"),
      at(new Date(2026, 7, 26, 9), "newer"),
      at(new Date(2026, 7, 28, 9), "future"),
    ];
    expect(past(events, now).map((e) => e.title)).toEqual(["newer", "older"]);
  });

  it("together with upcoming, accounts for every readable event", () => {
    const events = [
      at(new Date(2026, 7, 20), "a"),
      at(new Date(2026, 7, 28), "b"),
      at(now, "c"),
    ];
    expect(upcoming(events, now).length + past(events, now).length).toBe(3);
  });
});

describe("eventsOn", () => {
  it("finds a day's events in the order they happen", () => {
    const events = [
      at(new Date(2026, 7, 27, 16), "afternoon"),
      at(new Date(2026, 7, 27, 9), "morning"),
      at(new Date(2026, 7, 28, 9), "tomorrow"),
    ];
    expect(eventsOn(events, "2026-08-27").map((e) => e.title)).toEqual([
      "morning",
      "afternoon",
    ]);
  });

  it("uses the local day, so a late evening event is not tomorrow's", () => {
    const evening = at(new Date(2026, 7, 27, 23, 30), "late");
    expect(eventsOn([evening], "2026-08-27")).toHaveLength(1);
  });
});

describe("time formatting", () => {
  it("reads midnight as twelve, not zero", () => {
    // The one case a naive modulo gets wrong: "00:00 AM".
    expect(clockTime(new Date(2026, 7, 27, 0, 0).toISOString())).toBe("12:00 AM");
  });

  it("reads noon as twelve PM", () => {
    expect(clockTime(new Date(2026, 7, 27, 12, 0).toISOString())).toBe("12:00 PM");
  });

  it("reads an afternoon time", () => {
    expect(clockTime(new Date(2026, 7, 27, 17, 5).toISOString())).toBe("05:05 PM");
  });

  it("does not crash on an unreadable timestamp", () => {
    expect(clockTime("nonsense")).toBe("--:--");
  });

  it("writes a date the way it reads on the card", () => {
    expect(longDate(new Date(2026, 7, 26).toISOString())).toBe("Aug 26, 2026");
  });

  it("returns the raw value rather than nothing for a bad date", () => {
    expect(longDate("nonsense")).toBe("nonsense");
  });

  it("turns a reminder's wall clock into something readable", () => {
    expect(clockFromHhMm("07:00")).toBe("07:00 AM");
    expect(clockFromHhMm("00:00")).toBe("12:00 AM");
    expect(clockFromHhMm("12:00")).toBe("12:00 PM");
    expect(clockFromHhMm("22:30")).toBe("10:30 PM");
  });

  it("leaves a malformed reminder time alone", () => {
    expect(clockFromHhMm("morning")).toBe("morning");
  });
});

describe("localDayOf", () => {
  it("uses the reader's clock, not UTC", () => {
    expect(localDayOf(new Date(2026, 7, 27, 23, 30).toISOString())).toBe("2026-08-27");
  });
});

describe("isReadable", () => {
  it("tells a timestamp from a wish", () => {
    expect(isReadable(new Date().toISOString())).toBe(true);
    expect(isReadable("next tuesday")).toBe(false);
  });
});

describe("byTimeOfDay", () => {
  const r = (at: string, text: string): Reminder => ({ id: text, text, at, done: false });

  it("puts reminders in the order of the day", () => {
    const list = [r("21:00", "plan"), r("07:00", "exercise"), r("12:00", "lunch")];
    expect(byTimeOfDay(list).map((x) => x.at)).toEqual(["07:00", "12:00", "21:00"]);
  });

  it("does not reorder the caller's array", () => {
    const list = [r("21:00", "plan"), r("07:00", "exercise")];
    byTimeOfDay(list);
    expect(list[0].at).toBe("21:00");
  });
});
