import { beforeEach, describe, expect, it } from "vitest";
import {
  loadDismissed,
  loadTrayOpen,
  pruneDismissed,
  saveDismissed,
  saveTrayOpen,
} from "./trayState";

describe("tray open state", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to closed", () => {
    expect(loadTrayOpen()).toBe(false);
  });

  it("remembers being opened", () => {
    saveTrayOpen(true);
    expect(loadTrayOpen()).toBe(true);
  });

  it("remembers being closed again", () => {
    saveTrayOpen(true);
    saveTrayOpen(false);
    expect(loadTrayOpen()).toBe(false);
  });

  it("survives storage being unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() => loadTrayOpen()).not.toThrow();
    expect(loadTrayOpen()).toBe(false);
    expect(() => saveTrayOpen(true)).not.toThrow();
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});

describe("dismissed notifications", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadDismissed()).toEqual(new Set());
  });

  it("remembers what was dismissed", () => {
    saveDismissed(new Set(["event:e1", "reminder:r1:2026-08-27"]));
    expect(loadDismissed()).toEqual(new Set(["event:e1", "reminder:r1:2026-08-27"]));
  });

  it("treats corrupt stored JSON as nothing dismissed, not a crash", () => {
    localStorage.setItem("jky.notifications.dismissed", "{ not json");
    expect(() => loadDismissed()).not.toThrow();
    expect(loadDismissed()).toEqual(new Set());
  });

  it("ignores a stored value that is not an array of strings", () => {
    localStorage.setItem("jky.notifications.dismissed", JSON.stringify({ not: "an array" }));
    expect(loadDismissed()).toEqual(new Set());
  });
});

describe("pruneDismissed", () => {
  it("drops a key once it is no longer among what is due", () => {
    const dismissed = new Set(["event:e1", "event:e2"]);
    const stillDue = new Set(["event:e2"]);
    expect(pruneDismissed(dismissed, stillDue)).toEqual(new Set(["event:e2"]));
  });

  it("keeps every key that is still due", () => {
    const dismissed = new Set(["event:e1"]);
    expect(pruneDismissed(dismissed, new Set(["event:e1"]))).toEqual(new Set(["event:e1"]));
  });

  it("never adds a key that was not already dismissed", () => {
    const result = pruneDismissed(new Set(), new Set(["event:e1"]));
    expect(result).toEqual(new Set());
  });
});
