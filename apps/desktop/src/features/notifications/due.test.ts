import { describe, expect, it } from "vitest";
import { agoWords, dueEvents, dueNotifications, dueReminders, dueTodos } from "./due";
import type { Event, Reminder, Todo } from "../../platform";

const now = new Date(2026, 7, 27, 12, 0, 0);

const event = (over: Partial<Event> = {}): Event => ({
  id: "e1",
  title: "Team meeting",
  starts_at: new Date(2026, 7, 27, 12, 30, 0).toISOString(),
  colour: "cyan",
  alert_minutes_before: 30,
  ...over,
});

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  text: "Exercise",
  at: "07:00",
  done: false,
  ...over,
});

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: "t1",
  text: "Ship the release",
  done: false,
  created_at: new Date(2026, 7, 26, 12, 0, 0).toISOString(),
  ...over,
});

describe("dueEvents", () => {
  it("finds nothing when nothing has an alert", () => {
    expect(dueEvents([event({ alert_minutes_before: null })], now)).toEqual([]);
  });

  it("is due once its lead time has opened", () => {
    // Starts at 12:30, lead 30 min, so the window opens at 12:00 — exactly now.
    const [item] = dueEvents([event()], now);
    expect(item.id).toBe("e1");
    expect(item.kind).toBe("event");
  });

  it("is not due before its lead time opens", () => {
    const earlier = new Date(2026, 7, 27, 11, 59, 0);
    expect(dueEvents([event()], earlier)).toEqual([]);
  });

  it("stops being due once the event has started", () => {
    // The upper bound: a machine reopened long after the meeting started
    // must not declare it "due right now".
    const started = new Date(2026, 7, 27, 12, 30, 0);
    expect(dueEvents([event()], started)).toEqual([]);
  });

  it("carries the colour through, for the dot in the tray", () => {
    const [item] = dueEvents([event({ colour: "rose" })], now);
    expect(item.colour).toBe("rose");
  });

  it("says how long until it starts", () => {
    const [item] = dueEvents([event()], now);
    expect(item.detail).toBe("in 30 min");
  });

  it("says 'starting now' in the last minute, not 'in 0 min'", () => {
    const almostStarted = new Date(2026, 7, 27, 12, 29, 45);
    const [item] = dueEvents([event()], almostStarted);
    expect(item.detail).toBe("starting now");
  });

  it("an unreadable timestamp is skipped rather than crashing", () => {
    expect(dueEvents([event({ starts_at: "not a date" })], now)).toEqual([]);
  });

  it("gives each due event a stable, dismissal-friendly key", () => {
    const [item] = dueEvents([event()], now);
    expect(item.key).toBe("event:e1");
  });

  it("is urgent enough to interrupt with a banner", () => {
    expect(dueEvents([event()], now)[0].urgent).toBe(true);
  });
});

describe("dueReminders", () => {
  it("is due once its time has passed and it is not done", () => {
    const [item] = dueReminders([reminder({ at: "07:00" })], now);
    expect(item.id).toBe("r1");
    expect(item.kind).toBe("reminder");
  });

  it("is not due before its time", () => {
    expect(dueReminders([reminder({ at: "18:00" })], now)).toEqual([]);
  });

  it("is due at the exact minute", () => {
    const exact = new Date(2026, 7, 27, 7, 0, 0);
    expect(dueReminders([reminder({ at: "07:00" })], exact)).toHaveLength(1);
  });

  it("a done reminder is never due, however late it is", () => {
    expect(dueReminders([reminder({ at: "07:00", done: true })], now)).toEqual([]);
  });

  it("shows the scheduled time as the detail", () => {
    const [item] = dueReminders([reminder({ at: "07:00" })], now);
    expect(item.detail).toBe("due at 07:00");
  });

  it("keys a reminder to today's date, so tomorrow gets a fresh key", () => {
    const [item] = dueReminders([reminder()], now);
    expect(item.key).toBe("reminder:r1:2026-08-27");

    const tomorrow = new Date(2026, 7, 28, 8, 0, 0);
    const [nextDay] = dueReminders([reminder()], tomorrow);
    expect(nextDay.key).not.toBe(item.key);
  });
});

describe("dueTodos", () => {
  it("lists every todo that is not done", () => {
    // The whole point: a todo has no clock, so it is due simply by being open.
    const [item] = dueTodos([todo()], now);
    expect(item.id).toBe("t1");
    expect(item.kind).toBe("todo");
  });

  it("leaves out a todo that is done", () => {
    expect(dueTodos([todo({ done: true })], now)).toEqual([]);
  });

  it("says how long it has been sitting there", () => {
    const [item] = dueTodos([todo()], now);
    expect(item.detail).toBe("open · added 1d ago");
  });

  it("never raises a banner, because it has no moment to interrupt for", () => {
    expect(dueTodos([todo()], now)[0].urgent).toBe(false);
  });

  it("survives an unreadable created_at rather than crashing", () => {
    expect(() => dueTodos([todo({ created_at: "whenever" })], now)).not.toThrow();
    expect(dueTodos([todo({ created_at: "whenever" })], now)).toHaveLength(1);
  });

  it("gives each todo a stable, dismissal-friendly key", () => {
    expect(dueTodos([todo()], now)[0].key).toBe("todo:t1");
  });
});

describe("dueNotifications", () => {
  it("combines events, reminders and todos", () => {
    const items = dueNotifications([event()], [reminder()], [todo()], now);
    expect(items.map((i) => i.kind)).toEqual(["event", "reminder", "todo"]);
  });

  it("puts what is about to happen above what has merely been open a while", () => {
    // An event starting in two minutes outranks a reminder from seven this
    // morning, which outranks a todo with no clock on it at all.
    const items = dueNotifications([event()], [reminder()], [todo()], now);
    expect(items[0].kind).toBe("event");
    expect(items[items.length - 1].kind).toBe("todo");
  });

  it("orders two events by which starts sooner", () => {
    const sooner = event({
      id: "sooner",
      starts_at: new Date(2026, 7, 27, 12, 5, 0).toISOString(),
    });
    const later = event({
      id: "later",
      starts_at: new Date(2026, 7, 27, 12, 25, 0).toISOString(),
    });
    const items = dueNotifications([later, sooner], [], [], now);
    expect(items.map((i) => i.id)).toEqual(["sooner", "later"]);
  });

  it("is empty when nothing is due", () => {
    expect(dueNotifications([], [], [], now)).toEqual([]);
  });

  it("defaults now to the real clock when not given one", () => {
    expect(Array.isArray(dueNotifications([], []))).toBe(true);
  });
});

describe("agoWords", () => {
  it("reads as a stamp rather than a number of milliseconds", () => {
    expect(agoWords(0)).toBe("just now");
    expect(agoWords(30_000)).toBe("just now");
    expect(agoWords(60_000)).toBe("1m ago");
    expect(agoWords(45 * 60_000)).toBe("45m ago");
    expect(agoWords(3 * 3_600_000)).toBe("3h ago");
    expect(agoWords(2 * 86_400_000)).toBe("2d ago");
  });
});
