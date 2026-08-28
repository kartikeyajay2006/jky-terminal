import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_TALLY,
  highScore,
  padScore,
  readTally,
  resetTally,
  submitScore,
  writeTally,
} from "./scores";

describe("high scores", () => {
  beforeEach(() => localStorage.clear());

  it("starts at nothing", () => {
    expect(highScore("dino")).toBe(0);
  });

  it("remembers a score", () => {
    submitScore("dino", 1256);
    expect(highScore("dino")).toBe(1256);
  });

  it("keeps the best, not the latest", () => {
    submitScore("snake", 500);
    submitScore("snake", 120);
    expect(highScore("snake")).toBe(500);
  });

  it("reports the score now standing", () => {
    expect(submitScore("flappy", 30)).toBe(30);
    expect(submitScore("flappy", 10)).toBe(30);
    expect(submitScore("flappy", 90)).toBe(90);
  });

  it("keeps each game's score apart", () => {
    submitScore("dino", 900);
    submitScore("snake", 100);
    expect(highScore("dino")).toBe(900);
    expect(highScore("snake")).toBe(100);
    expect(highScore("flappy")).toBe(0);
  });

  it("survives the app being restarted", () => {
    submitScore("dino", 4567);
    // A fresh read is all a reload does.
    expect(highScore("dino")).toBe(4567);
  });

  it("refuses a score that is not a number", () => {
    // A NaN on the scoreboard would beat every real score it was compared
    // against, forever.
    submitScore("dino", Number.NaN);
    expect(highScore("dino")).toBe(0);
    submitScore("dino", Number.POSITIVE_INFINITY);
    expect(highScore("dino")).toBe(0);
  });

  it("refuses a negative score", () => {
    submitScore("dino", -50);
    expect(highScore("dino")).toBe(0);
  });

  it("stores whole numbers only", () => {
    submitScore("dino", 12.9);
    expect(highScore("dino")).toBe(12);
  });

  it("treats a corrupt store as no scores rather than crashing", () => {
    localStorage.setItem("jky.games.highscores", "{ not json");
    expect(() => highScore("dino")).not.toThrow();
    expect(highScore("dino")).toBe(0);
  });

  it("ignores a stored value that is not a number", () => {
    localStorage.setItem("jky.games.highscores", JSON.stringify({ dino: "lots" }));
    expect(highScore("dino")).toBe(0);
  });

  it("still records a score when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    // A forgotten high score is a disappointment; a game that will not start
    // is a bug.
    expect(() => submitScore("dino", 10)).not.toThrow();
    expect(submitScore("dino", 10)).toBe(10);
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});

describe("the tic-tac-toe tally", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(readTally()).toEqual(EMPTY_TALLY);
  });

  it("remembers wins and draws", () => {
    writeTally({ x: 2, o: 1, draws: 3 });
    expect(readTally()).toEqual({ x: 2, o: 1, draws: 3 });
  });

  it("can be cleared", () => {
    writeTally({ x: 5, o: 5, draws: 5 });
    expect(resetTally()).toEqual(EMPTY_TALLY);
    expect(readTally()).toEqual(EMPTY_TALLY);
  });

  it("treats a corrupt store as an empty tally", () => {
    localStorage.setItem("jky.games.tictactoe", "nonsense");
    expect(readTally()).toEqual(EMPTY_TALLY);
  });

  it("replaces a nonsense count with zero rather than showing it", () => {
    localStorage.setItem(
      "jky.games.tictactoe",
      JSON.stringify({ x: "many", o: -3, draws: 2 }),
    );
    expect(readTally()).toEqual({ x: 0, o: 0, draws: 2 });
  });

  it("hands back a fresh object each read, not a shared one", () => {
    const a = readTally();
    a.x = 99;
    expect(readTally().x).toBe(0);
  });
});

describe("padding a score", () => {
  it("pads to arcade width", () => {
    expect(padScore(1256)).toBe("01256");
    expect(padScore(0)).toBe("00000");
  });

  it("does not truncate a score wider than the padding", () => {
    expect(padScore(123456)).toBe("123456");
  });

  it("takes a width", () => {
    expect(padScore(32, 4)).toBe("0032");
  });

  it("never shows a negative or fractional score", () => {
    expect(padScore(-5)).toBe("00000");
    expect(padScore(12.7)).toBe("00012");
  });
});
