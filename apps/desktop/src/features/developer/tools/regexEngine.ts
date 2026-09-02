/**
 * Running one regular expression against some text.
 *
 * Pure, and deliberately separate from the worker that calls it: the
 * behaviour worth testing is here, and the worker is four lines of plumbing
 * around it. See `useRegex` for why there is a worker at all.
 */

/** The flags worth offering, with what each one does. */
export const FLAGS: { flag: string; label: string }[] = [
  { flag: "g", label: "all matches" },
  { flag: "i", label: "ignore case" },
  { flag: "m", label: "^ and $ match lines" },
  { flag: "s", label: ". matches newlines" },
  { flag: "u", label: "unicode" },
  { flag: "y", label: "sticky" },
];

/** More matches than any list can usefully show. */
const MAX_MATCHES = 1000;

export interface RegexMatch {
  text: string;
  index: number;
  /** Capture groups in order. `undefined` for one that did not take part. */
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export type RegexResult =
  | { ok: true; matches: RegexMatch[]; truncated: boolean }
  | { ok: false; message: string };

export function runRegex(pattern: string, flags: string, text: string): RegexResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "that is not a pattern" };
  }

  const matches: RegexMatch[] = [];

  if (!re.global && !re.sticky) {
    const found = re.exec(text);
    if (found) matches.push(describe(found));
    return { ok: true, matches, truncated: false };
  }

  let truncated = false;
  let found: RegExpExecArray | null;
  while ((found = re.exec(text)) !== null) {
    matches.push(describe(found));

    // An empty match does not move `lastIndex`, so trusting it would loop
    // for ever — the classic way to hang a regex tester with no backtracking
    // involved at all.
    if (found[0] === "") re.lastIndex += 1;

    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
  }

  return { ok: true, matches, truncated };
}

function describe(found: RegExpExecArray): RegexMatch {
  return {
    text: found[0],
    index: found.index,
    groups: found.slice(1),
    named: { ...found.groups },
  };
}

/** A run of text, and whether the pattern matched it. */
export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * The text, split into what matched and what did not.
 *
 * Seeing *where* a pattern matched is most of what a regex tester is for. A
 * list of matched strings tells you what was found; it does not tell you that
 * the pattern swallowed the comma as well, or stopped one character short of
 * what you meant. The text with the matches marked in it does.
 *
 * A zero-width match is skipped: it has a position but no characters, and
 * marking it would highlight the character after it, which did not match.
 */
export function segments(text: string, matches: RegexMatch[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;

  for (const match of matches) {
    if (match.text === "" || match.index < at) continue;
    if (match.index > at) out.push({ text: text.slice(at, match.index), hit: false });
    out.push({ text: match.text, hit: true });
    at = match.index + match.text.length;
  }

  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
