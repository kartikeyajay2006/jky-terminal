import { describe, expect, it } from "vitest";
import { formatJson, minifyJson, describeJson } from "./json";

describe("formatJson", () => {
  it("indents valid JSON", () => {
    const out = formatJson('{"a":1,"b":[2,3]}', 2);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    }
  });

  it("takes the indent it is given", () => {
    const four = formatJson('{"a":1}', 4);
    expect(four.ok && four.text).toContain('\n    "a"');
  });

  /*
   * An error has to say *where*.
   *
   * "Unexpected token" in three hundred lines of JSON is not a message, it is
   * a search. The engine reports a character offset; a line and column is
   * what a person can act on, so the offset is converted here.
   */
  it("says which line and column stopped it", () => {
    const out = formatJson('{\n  "a": 1,\n  "b": ,\n}', 2);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.line).toBe(3);
      expect(out.column).toBeGreaterThan(0);
      expect(out.message).not.toBe("");
    }
  });

  /*
   * Engines disagree about whether to report a position at all.
   *
   * V8 gives "at position 12 (line 3 column 8)" for some failures and a
   * snippet with no position for others — so the position is found by
   * searching prefixes rather than by reading the prose, and these are the
   * shapes that produced no position when this was written.
   */
  it("finds the position even when the engine will not give one", () => {
    for (const [source, line, column] of [
      ['{\n  "a": 1,\n  "b": ,\n}', 3, 8],
      ['{"a":}', 1, 6],
      ['{\n"a": 1\n"b": 2\n}', 3, 1],
      ["[1,2,]", 1, 6],
      ['[true, tru]', 1, 11],
    ] as const) {
      const out = formatJson(source, 2);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.line, `wrong line for ${JSON.stringify(source)}`).toBe(line);
        expect(out.column, `wrong column for ${JSON.stringify(source)}`).toBe(column);
      }
    }
  });

  /*
   * A document that merely ran out has no offending character.
   *
   * An unterminated string is the everyday case: nothing in it is wrong yet,
   * and blaming its last character would send someone to look at a quote mark
   * that is perfectly correct.
   */
  it("does not blame a character when the document is only unfinished", () => {
    const out = formatJson('{"a": "unterminated', 2);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/end|unterminated/i);
  });

  // A document too large to search says the message without inventing a
  // place. A wrong line number is worse than none.
  it("reports without a position rather than guessing at one", () => {
    const huge = `{"a": ${"1".repeat(300_000)}x}`;
    const out = formatJson(huge, 2);
    expect(out.ok).toBe(false);
  });

  it("points at the first line when the trouble is there", () => {
    const out = formatJson("nope", 2);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.line).toBe(1);
  });

  // Empty input is not an error to shout about; it is an empty box.
  it("treats nothing as nothing rather than as broken", () => {
    const out = formatJson("   ", 2);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe("");
  });

  it("keeps a document that is already formatted unchanged", () => {
    const pretty = '{\n  "a": 1\n}';
    const out = formatJson(pretty, 2);
    expect(out.ok && out.text).toBe(pretty);
  });

  // JSON is not only objects.
  it("formats the values that are documents in their own right", () => {
    for (const doc of ["[1,2]", '"a string"', "42", "true", "null"]) {
      expect(formatJson(doc, 2).ok, `${doc} was refused`).toBe(true);
    }
  });

  /*
   * Numbers larger than JavaScript can hold.
   *
   * `JSON.parse` silently rounds a 20-digit integer, so a formatter that
   * round-trips through it hands back a *different number* while claiming to
   * have only reindented. Better to say so than to quietly corrupt an id.
   */
  it("warns when reformatting would change a number", () => {
    const out = formatJson('{"id":12345678901234567890}', 2);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.lostPrecision).toBe(true);
  });

  it("does not cry precision over ordinary numbers", () => {
    const out = formatJson('{"a":1,"b":1.5,"c":-20}', 2);
    expect(out.ok && out.lostPrecision).toBe(false);
  });
});

describe("minifyJson", () => {
  it("takes the whitespace out", () => {
    const out = minifyJson('{\n  "a": 1\n}');
    expect(out.ok && out.text).toBe('{"a":1}');
  });

  it("reports the same errors the formatter does", () => {
    expect(minifyJson("{").ok).toBe(false);
  });
});

describe("describeJson", () => {
  /*
   * What is actually in there.
   *
   * A formatter shows you the shape; this answers the question you opened the
   * tool with — how many of these are there, and how deep does it go.
   */
  it("counts what a document holds", () => {
    const d = describeJson('{"a":[1,2,3],"b":{"c":{"d":1}}}');
    expect(d).not.toBeNull();
    expect(d!.keys).toBe(4);
    expect(d!.arrays).toBe(1);
    expect(d!.depth).toBe(4);
  });

  it("describes a bare value", () => {
    expect(describeJson("42")).toMatchObject({ depth: 1, keys: 0, arrays: 0 });
  });

  it("says nothing about a document it cannot read", () => {
    expect(describeJson("{")).toBeNull();
  });
});
