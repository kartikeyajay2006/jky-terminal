import { describe, expect, it } from "vitest";
import { highlight, rank, score } from "./match";

describe("scoring a candidate", () => {
  it("matches letters in order, not as a substring", () => {
    // The whole trick: "dsn" finds "Dashboard · Notes".
    expect(score("dsn", "Dashboard · Notes").score).toBeGreaterThan(0);
  });

  it("refuses a query whose letters are out of order", () => {
    expect(score("nsd", "Dashboard · Notes").score).toBe(-1);
  });

  it("refuses a query longer than the candidate", () => {
    expect(score("dashboards and more", "Dash").score).toBe(-1);
  });

  it("scores an empty query as neutral rather than refusing it", () => {
    expect(score("", "anything").score).toBe(0);
  });

  it("ignores case on both sides", () => {
    expect(score("DASH", "dashboard").score).toBeGreaterThan(0);
    expect(score("dash", "DASHBOARD").score).toBeGreaterThan(0);
  });

  it("reports which letters it matched, for highlighting", () => {
    expect(score("ab", "abc").hits).toEqual([0, 1]);
  });

  it("prefers a match at the start over one in the middle", () => {
    // People type the beginning of a name.
    const start = score("set", "Settings").score;
    const middle = score("set", "Reset the board").score;
    expect(start).toBeGreaterThan(middle);
  });

  it("prefers consecutive letters over scattered ones", () => {
    const run = score("term", "Terminal").score;
    const scattered = score("term", "Theme · Extra Rich Mint").score;
    expect(run).toBeGreaterThan(scattered);
  });

  it("prefers word starts, so initials work", () => {
    const initials = score("tt", "Tic Tac").score;
    const inside = score("tt", "attention").score;
    expect(initials).toBeGreaterThan(inside);
  });

  it("breaks a tie towards the shorter name", () => {
    const short = score("snake", "Snake").score;
    const long = score("snake", "Snake high score reset and other things").score;
    expect(short).toBeGreaterThan(long);
  });
});

describe("ranking a list", () => {
  const items = ["Dashboard", "Dashboard · Notes", "Settings", "Play Snake"];

  it("returns everything, in order, for an empty query", () => {
    // What a palette should show when it opens: the list as curated, not
    // shuffled by a scorer that had nothing to go on.
    expect(rank("", items, (s) => s).map((r) => r.item)).toEqual(items);
  });

  it("returns only what matches", () => {
    const out = rank("snake", items, (s) => s).map((r) => r.item);
    expect(out).toEqual(["Play Snake"]);
  });

  it("puts the best match first", () => {
    const out = rank("dash", items, (s) => s).map((r) => r.item);
    expect(out[0]).toBe("Dashboard");
  });

  it("returns nothing when nothing matches", () => {
    expect(rank("zzzz", items, (s) => s)).toEqual([]);
  });

  it("carries the matched indices through", () => {
    const [first] = rank("set", ["Settings"], (s) => s);
    expect(first.hits.length).toBe(3);
  });

  it("uses the text function it is given, not the item itself", () => {
    const objects = [{ name: "Snake" }, { name: "Dino" }];
    const out = rank("din", objects, (o) => o.name);
    expect(out[0].item.name).toBe("Dino");
  });
});

describe("highlighting", () => {
  it("splits into matched and unmatched runs", () => {
    expect(highlight("abc", [0])).toEqual([
      { text: "a", hit: true },
      { text: "bc", hit: false },
    ]);
  });

  it("joins adjacent matches into one run", () => {
    expect(highlight("abcd", [0, 1])).toEqual([
      { text: "ab", hit: true },
      { text: "cd", hit: false },
    ]);
  });

  it("handles a match in the middle", () => {
    expect(highlight("abcd", [1, 2])).toEqual([
      { text: "a", hit: false },
      { text: "bc", hit: true },
      { text: "d", hit: false },
    ]);
  });

  it("returns one plain run when nothing matched", () => {
    expect(highlight("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });

  it("returns nothing for empty text", () => {
    expect(highlight("", [])).toEqual([]);
  });

  it("puts the text back together exactly", () => {
    // The property that matters: highlighting must not lose or duplicate a
    // character, or a label silently changes when it matches.
    const text = "Dashboard · Notes";
    const runs = highlight(text, [0, 1, 12]);
    expect(runs.map((r) => r.text).join("")).toBe(text);
  });
});
