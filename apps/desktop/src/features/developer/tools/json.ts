/**
 * The JSON tool.
 *
 * In TypeScript rather than Rust because `JSON.parse` is already here and
 * already fast: a round trip through IPC to reindent a document would cost a
 * frame and buy nothing.
 *
 * Two things it does that the language does not. It converts the parser's
 * character offset into a line and column, because "unexpected token" in
 * three hundred lines is a search rather than a message. And it notices when
 * reformatting would silently change a number — `JSON.parse` rounds anything
 * past 2^53, so a formatter that round-trips through it can hand back a
 * different id while claiming to have only reindented.
 */

export type JsonResult =
  | { ok: true; text: string; lostPrecision: boolean }
  | { ok: false; message: string; line: number; column: number };

/** Where an offset falls, counting from 1 as every editor does. */
function positionOf(text: string, offset: number): { line: number; column: number } {
  const upTo = text.slice(0, Math.max(0, offset));
  const lines = upTo.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * The character offset an engine blamed, if it named one.
 *
 * Engines are inconsistent about this and change their minds between
 * versions. V8 currently reports `at position 12 (line 3 column 8)` for some
 * failures and, for others, a snippet of the source with no position at all.
 * So this is only a fast path — `findFault` covers the rest.
 */
function offsetIn(message: string): number | null {
  const found = /position (\d+)/.exec(message);
  return found ? Number(found[1]) : null;
}

/** How much text is worth searching for a position. See `findFault`. */
const MAX_SEARCH = 256 * 1024;

/**
 * Whether a prefix is merely unfinished, as opposed to actually wrong.
 *
 * This is the whole of the trick below, and the obvious version of it is
 * wrong. "Unexpected end of JSON input" looks like the answer, but V8 does
 * not use it consistently: given `{`, it says *"Expected property name or '}'
 * at position 1"*, which reads like a syntax error and is nothing of the
 * sort. What distinguishes the two is **where** it stopped — a document that
 * simply ran out fails at its own end, and a document with a mistake in it
 * fails before that.
 *
 * So: parsed, or ended early, or failed at the very last character.
 */
function stillFine(prefix: string): boolean {
  try {
    JSON.parse(prefix);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/unexpected end/i.test(message)) return true;
    const at = offsetIn(message);
    return at === null ? false : at >= prefix.length;
  }
}

/**
 * Find the offending character ourselves, when the engine will not say.
 *
 * Binary search over prefixes of the document. `stillFine` turns off exactly
 * once and never back on — adding characters cannot repair a mistake already
 * made — which is what makes the search sound. Checked against a linear scan
 * over a battery of broken documents; the two agree on every one.
 *
 * A document that is only truncated has no offending character, and this
 * says so rather than blaming its last one. An unterminated string is the
 * everyday case: nothing in it is wrong yet.
 *
 * Bounded, because this runs about twenty real parses. Past the bound the
 * error is reported without a position, which is honest — the alternative is
 * a tool that stops to think about a file it has already called broken.
 */
function findFault(text: string): number | null {
  if (text.length > MAX_SEARCH || stillFine(text)) return null;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (stillFine(text.slice(0, mid))) low = mid + 1;
    else high = mid;
  }
  return Math.max(0, low - 1);
}

/**
 * Whether re-serialising would change a number.
 *
 * Compares the long integers written in the source against the ones in the
 * output. `JSON.parse` rounds anything past 2^53, so a formatter that
 * round-trips through it can hand back a different id while claiming to have
 * only reindented — and quietly corrupting an identifier is worse than any
 * formatting this tool could do for you.
 */
function precisionLost(source: string, output: string): boolean {
  const longIntegers = (text: string) =>
    (text.match(/(?<![\w."])-?\d{16,}(?![\w."])/g) ?? []).sort();

  const before = longIntegers(source);
  if (before.length === 0) return false;
  return JSON.stringify(before) !== JSON.stringify(longIntegers(output));
}

function reserialise(text: string, indent: number): JsonResult {
  // Nothing typed yet is an empty box, not a mistake to shout about.
  if (text.trim() === "") return { ok: true, text: "", lostPrecision: false };

  try {
    const value: unknown = JSON.parse(text);
    const out = JSON.stringify(value, null, indent) ?? "";
    return { ok: true, text: out, lostPrecision: precisionLost(text, out) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const offset = offsetIn(message) ?? findFault(text);
    const at = offset === null ? { line: 1, column: 1 } : positionOf(text, offset);
    return { ok: false, message, ...at };
  }
}

export function formatJson(text: string, indent: number): JsonResult {
  return reserialise(text, indent);
}

export function minifyJson(text: string): JsonResult {
  return reserialise(text, 0);
}

export interface JsonShape {
  /** Every key at every depth, not only the top level. */
  keys: number;
  arrays: number;
  /** How far down it goes. A bare value is 1. */
  depth: number;
}

/**
 * What is actually in there.
 *
 * The formatter shows the shape; this answers the question people open the
 * tool with — how much of this is there, and how deep does it go.
 */
export function describeJson(text: string): JsonShape | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const shape: JsonShape = { keys: 0, arrays: 0, depth: 0 };

  const walk = (node: unknown, depth: number) => {
    shape.depth = Math.max(shape.depth, depth);
    if (Array.isArray(node)) {
      shape.arrays += 1;
      for (const child of node) walk(child, depth + 1);
    } else if (typeof node === "object" && node !== null) {
      for (const [, child] of Object.entries(node)) {
        shape.keys += 1;
        walk(child, depth + 1);
      }
    }
  };

  walk(value, 1);
  return shape;
}
