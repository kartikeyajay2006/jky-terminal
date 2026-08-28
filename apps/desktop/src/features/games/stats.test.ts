import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_STATS, averageScore, recordPlay, statsFor, totalPlays } from "./stats";

describe("per-game stats", () => {
  beforeEach(() => localStorage.clear());

  it("starts at nothing", () => {
    expect(statsFor("dino")).toEqual(EMPTY_STATS);
  });

  it("counts a round", () => {
    recordPlay("dino", 120);
    expect(statsFor("dino")).toEqual({ plays: 1, total: 120 });
  });

  it("adds rounds up", () => {
    recordPlay("snake", 30);
    recordPlay("snake", 70);
    expect(statsFor("snake")).toEqual({ plays: 2, total: 100 });
  });

  it("counts a scoreless round as a round", () => {
    // Dying immediately is still a go, and a play count that ignored it
    // would quietly disagree with the average it feeds.
    recordPlay("flappy", 0);
    expect(statsFor("flappy").plays).toBe(1);
  });

  it("keeps each game apart", () => {
    recordPlay("dino", 10);
    recordPlay("snake", 90);
    expect(statsFor("dino").total).toBe(10);
    expect(statsFor("snake").total).toBe(90);
    expect(statsFor("flappy")).toEqual(EMPTY_STATS);
  });

  it("refuses a score that is not a number", () => {
    recordPlay("dino", Number.NaN);
    expect(statsFor("dino")).toEqual({ plays: 1, total: 0 });
  });

  it("refuses a negative score", () => {
    recordPlay("dino", -40);
    expect(statsFor("dino").total).toBe(0);
  });

  it("treats a corrupt store as no history rather than crashing", () => {
    localStorage.setItem("jky.games.stats", "{ not json");
    expect(() => statsFor("dino")).not.toThrow();
    expect(statsFor("dino")).toEqual(EMPTY_STATS);
  });

  it("replaces a nonsense count with zero rather than showing it", () => {
    localStorage.setItem(
      "jky.games.stats",
      JSON.stringify({ dino: { plays: "many", total: 40 } }),
    );
    expect(statsFor("dino")).toEqual({ plays: 0, total: 40 });
  });

  it("hands back a fresh object each read, not a shared one", () => {
    const a = statsFor("dino");
    a.plays = 99;
    expect(statsFor("dino").plays).toBe(0);
  });

  it("still counts a round when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() => recordPlay("dino", 10)).not.toThrow();
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});

describe("totals across the arcade", () => {
  beforeEach(() => localStorage.clear());

  it("starts at nothing", () => {
    expect(totalPlays()).toBe(0);
  });

  it("adds up every game's rounds", () => {
    recordPlay("dino", 5);
    recordPlay("snake", 5);
    recordPlay("snake", 5);
    expect(totalPlays()).toBe(3);
  });
});

describe("the average", () => {
  beforeEach(() => localStorage.clear());

  it("says nothing before anything has been played", () => {
    // Null rather than zero: "you average nothing" and "you have not played"
    // are different statements, and only one is true on a first visit.
    expect(averageScore("dino")).toBeNull();
  });

  it("is the mean of every round", () => {
    recordPlay("dino", 100);
    recordPlay("dino", 200);
    expect(averageScore("dino")).toBe(150);
  });

  it("rounds to a whole number, since a score is one", () => {
    recordPlay("dino", 10);
    recordPlay("dino", 11);
    expect(averageScore("dino")).toBe(11);
  });
});
