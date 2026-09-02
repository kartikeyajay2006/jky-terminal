import { describe, expect, it } from "vitest";
import { runRegex, segments, FLAGS } from "./regexEngine";

describe("segments", () => {
  /*
   * Seeing where a pattern matched is most of what a regex tester is for.
   *
   * A list of matched strings tells you what was found; it does not tell you
   * that the pattern swallowed the comma too, or stopped one character short.
   * The text with the matches marked in it does.
   */
  it("splits the text into what matched and what did not", () => {
    const out = segments("xabyab", [
      { text: "ab", index: 1, groups: [], named: {} },
      { text: "ab", index: 4, groups: [], named: {} },
    ]);
    expect(out).toEqual([
      { text: "x", hit: false },
      { text: "ab", hit: true },
      { text: "y", hit: false },
      { text: "ab", hit: true },
    ]);
  });

  it("marks a match at the very start and the very end", () => {
    expect(segments("ab", [{ text: "ab", index: 0, groups: [], named: {} }])).toEqual([
      { text: "ab", hit: true },
    ]);
  });

  it("leaves text alone when nothing matched", () => {
    expect(segments("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });

  it("has nothing to show for nothing", () => {
    expect(segments("", [])).toEqual([]);
  });

  // An empty match has a position but no width; marking it would highlight
  // the character after it, which did not match.
  it("skips a match with no width", () => {
    const out = segments("abc", [{ text: "", index: 1, groups: [], named: {} }]);
    expect(out).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("runRegex", () => {
  it("finds every match, with where it was", () => {
    const out = runRegex("a(b)", "g", "xabyab");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.matches).toHaveLength(2);
      expect(out.matches[0]).toMatchObject({ text: "ab", index: 1 });
      expect(out.matches[0].groups).toEqual(["b"]);
      expect(out.matches[1].index).toBe(4);
    }
  });

  it("finds only the first without the global flag", () => {
    const out = runRegex("a", "", "aaa");
    expect(out.ok && out.matches).toHaveLength(1);
  });

  it("names the named groups", () => {
    const out = runRegex("(?<year>\\d{4})-(?<month>\\d{2})", "", "2026-09");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.matches[0].named).toEqual({ year: "2026", month: "09" });
  });

  it("says what is wrong with a pattern that is not one", () => {
    const out = runRegex("a(", "", "abc");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).not.toBe("");
  });

  it("refuses a flag that is not a flag", () => {
    expect(runRegex("a", "q", "abc").ok).toBe(false);
  });

  it("offers the flags a person actually uses", () => {
    expect(FLAGS.map((f) => f.flag).join("")).toBe("gimsuy");
  });

  /*
   * A pattern that matches nothing is a normal answer to a normal question,
   * and saying so is the point of the tool.
   */
  it("finds nothing without calling it an error", () => {
    const out = runRegex("zzz", "g", "abc");
    expect(out.ok && out.matches).toEqual([]);
  });

  /*
   * An empty match advances by one rather than for ever.
   *
   * `//g` and `/a*` /g match the empty string at every position; a loop that
   * trusted `lastIndex` to move would never terminate — the classic way to
   * hang a regex tester without any backtracking at all.
   */
  it("does not loop for ever on a pattern that matches nothing at all", () => {
    const out = runRegex("a*", "g", "bbb");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.matches.length).toBeLessThanOrEqual(4);
  });

  // A pattern matching every position on a large input would otherwise return
  // a list nothing can draw.
  it("stops collecting long before the list becomes unusable", () => {
    const out = runRegex(".", "g", "x".repeat(50_000));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.matches.length).toBeLessThanOrEqual(1000);
      expect(out.truncated).toBe(true);
    }
  });

  it("does not claim to have truncated when it has not", () => {
    const out = runRegex("a", "g", "aaa");
    expect(out.ok && out.truncated).toBe(false);
  });
});
