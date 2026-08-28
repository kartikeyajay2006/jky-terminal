/**
 * Subsequence matching, the way every command palette works.
 *
 * "dsn" finds "Dashboard · Notes" because the letters appear in order, not
 * because the string contains "dsn". That is the whole trick, and the rest of
 * this file is scoring: several entries usually match, and which one lands
 * first is what makes a palette feel like it read your mind or like it did not.
 */

export interface Scored<T> {
  item: T;
  score: number;
  /** Indices in the haystack that were matched, for highlighting. */
  hits: number[];
}

/** No match at all. Kept as a name because `null` reads as "no result". */
const NO_MATCH = -1;

/**
 * Score one candidate, or -1 when the query is not a subsequence of it.
 *
 * Higher is better. The weights encode what people actually mean when they
 * type three letters at a palette:
 *
 * - a match at the start of a word beats one in the middle, because people
 *   type initials
 * - consecutive letters beat scattered ones, because people type prefixes
 * - a short haystack beats a long one on equal footing, because an exact
 *   short name is more likely what was meant than a fragment of a long one
 */
export function score(query: string, haystack: string): { score: number; hits: number[] } {
  const q = query.trim().toLowerCase();
  const h = haystack.toLowerCase();

  if (q.length === 0) return { score: 0, hits: [] };
  if (q.length > h.length) return { score: NO_MATCH, hits: [] };

  const hits: number[] = [];
  let total = 0;
  let qi = 0;
  let previous = -2;

  for (let hi = 0; hi < h.length && qi < q.length; hi += 1) {
    if (h[hi] !== q[qi]) continue;

    let points = 1;

    // Immediately after the previous match: a run, which is what typing a
    // prefix produces.
    if (hi === previous + 1) points += 6;

    // At the start of the string, or the start of a word.
    const before = hi > 0 ? h[hi - 1] : " ";
    if (hi === 0) points += 10;
    else if (before === " " || before === "·" || before === "-" || before === "/") {
      points += 8;
    }
    // A capital in the middle of the original, which is how camelCase names
    // are read as words.
    else if (haystack[hi] >= "A" && haystack[hi] <= "Z") points += 5;

    total += points;
    hits.push(hi);
    previous = hi;
    qi += 1;
  }

  // Ran out of haystack before the query was consumed.
  if (qi < q.length) return { score: NO_MATCH, hits: [] };

  // Shorter names win ties, so "Snake" beats "Snake high score reset".
  total -= Math.floor(h.length / 12);

  return { score: total, hits };
}

/**
 * Rank a list against a query.
 *
 * With an empty query everything is returned in its original order, which is
 * what a palette should show when it opens: the list as curated, not shuffled
 * by a scorer that had nothing to go on.
 */
export function rank<T>(
  query: string,
  items: T[],
  text: (item: T) => string,
): Array<Scored<T>> {
  if (query.trim().length === 0) {
    return items.map((item) => ({ item, score: 0, hits: [] }));
  }

  const out: Array<Scored<T>> = [];
  for (const item of items) {
    const result = score(query, text(item));
    if (result.score !== NO_MATCH) {
      out.push({ item, score: result.score, hits: result.hits });
    }
  }

  // Sorted by score, and ties broken by the original order rather than left
  // to the sort's own stability guarantees — which hold in modern engines but
  // are not what the reader of this line should have to know.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Split a string into matched and unmatched runs, for rendering.
 *
 * Returned as runs rather than as indices so the component does not have to
 * do this itself, and so it is testable without a DOM.
 */
export function highlight(
  text: string,
  hits: number[],
): Array<{ text: string; hit: boolean }> {
  if (hits.length === 0) return text ? [{ text, hit: false }] : [];

  const marked = new Set(hits);
  const runs: Array<{ text: string; hit: boolean }> = [];

  for (let i = 0; i < text.length; i += 1) {
    const hit = marked.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
