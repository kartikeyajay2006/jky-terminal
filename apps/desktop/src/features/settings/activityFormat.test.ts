// Pinned before any Date exists. The offset is deliberately +05:30: a log
// read in UTC rather than on the reader's clock lands on the wrong day and
// the wrong hour here, and cannot pass by coincidence the way it would in a
// whole-hour zone.
process.env.TZ = "Asia/Kolkata";

import { describe, expect, it } from "vitest";
import { dayLabel, dayOf, groupByDay, shapeOf, timeOf } from "./activityFormat";

/** A local wall-clock moment, recorded the way the audit log records it. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => ({
  at: new Date(y, m - 1, d, h, min, 0).toISOString(),
  kind: "ToolCall",
  detail: "x",
});

describe("shapeOf", () => {
  it("gives every recorded kind a glyph and a label", () => {
    for (const kind of [
      "SecretRead",
      "ProviderRequest",
      "ToolCall",
      "CommandRun",
      "CommandRejected",
    ]) {
      const shape = shapeOf(kind);
      expect(shape.glyph.length).toBeGreaterThan(0);
      expect(shape.label.length).toBeGreaterThan(0);
    }
  });

  it("marks a declined command as the one to notice", () => {
    expect(shapeOf("CommandRejected").tone).toBe("danger");
    expect(shapeOf("CommandRun").tone).toBe("warn");
  });

  it("still shows a kind it does not recognise", () => {
    // A new event kind added later must appear in the log rather than vanish
    // from it — a log that silently drops entries is worse than none.
    const shape = shapeOf("SomethingNew");
    expect(shape.glyph.length).toBeGreaterThan(0);
    expect(shape.label.length).toBeGreaterThan(0);
  });
});

describe("timeOf", () => {
  it("shows the time it happened where the reader is, not in UTC", () => {
    // 19:29:59Z is ten to one the following morning in Delhi. Showing
    // "19:29" for something that happened at midnight is a plain lie about
    // when it happened.
    expect(timeOf("2026-08-26T19:29:59Z")).toBe("00:59:59");
  });

  it("reduces a timestamp to the time", () => {
    const at = new Date(2026, 7, 27, 14, 5, 9).toISOString();
    expect(timeOf(at)).toBe("14:05:09");
  });

  it("pads single digits so the column stays aligned", () => {
    const at = new Date(2026, 7, 27, 9, 5, 3).toISOString();
    expect(timeOf(at)).toBe("09:05:03");
  });

  it("returns the raw value rather than nothing when it cannot parse", () => {
    expect(timeOf("not-a-timestamp")).toBe("not-a-timestamp");
  });
});

describe("dayOf", () => {
  it("files an event under the local day, not the UTC one", () => {
    // Late-evening UTC is the next morning here, and an event belongs under
    // the day the person was living through when it happened.
    expect(dayOf("2026-08-26T19:29:59Z")).toBe("2026-08-27");
  });

  it("takes the date", () => {
    const at = new Date(2026, 7, 27, 14, 0, 0).toISOString();
    expect(dayOf(at)).toBe("2026-08-27");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 7, 27, 12, 0, 0);

  it("names today and yesterday rather than dating them", () => {
    // The two you actually look for; a date makes you work out which is which.
    expect(dayLabel("2026-08-27", now)).toBe("today");
    expect(dayLabel("2026-08-26", now)).toBe("yesterday");
  });

  it("dates anything older", () => {
    expect(dayLabel("2026-08-20", now)).toBe("2026-08-20");
  });

  it("handles a month boundary", () => {
    expect(dayLabel("2026-07-31", new Date(2026, 7, 1, 9, 0, 0))).toBe("yesterday");
  });

  it("calls it today when the reader's clock says so, whatever UTC says", () => {
    // 20:00Z on the 26th is 01:30 on the 27th here: today, for this reader.
    const late = new Date("2026-08-26T20:00:00Z");
    expect(dayLabel(dayOf("2026-08-26T19:30:00Z"), late)).toBe("today");
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 7, 27, 12, 0, 0);

  it("returns nothing for no events", () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it("groups events under their day", () => {
    const groups = groupByDay(
      [at(2026, 8, 27, 10), at(2026, 8, 27, 11), at(2026, 8, 26, 9)],
      now,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toHaveLength(2);
    expect(groups[1].events).toHaveLength(1);
  });

  it("puts the newest day first", () => {
    const groups = groupByDay([at(2026, 8, 20, 10), at(2026, 8, 27, 10)], now);
    expect(groups[0].label).toBe("today");
  });

  it("puts the newest event first within a day", () => {
    // What just happened is what you came to look at.
    const groups = groupByDay(
      [at(2026, 8, 27, 9), at(2026, 8, 27, 18)],
      now,
    );
    expect(timeOf(groups[0].events[0].at)).toBe("18:00:00");
  });

  it("labels each group", () => {
    const groups = groupByDay([at(2026, 8, 26, 10)], now);
    expect(groups[0].label).toBe("yesterday");
  });
});
