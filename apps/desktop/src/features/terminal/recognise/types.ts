/**
 * Turning a finished command into something you can use.
 *
 * A shell answers in text because a pipe is the only thing it can answer in.
 * That has nothing to do with what the answer *is*: `df` reports how full
 * four disks are, `docker ps` reports the state of five containers, and both
 * of those are tables that were flattened on the way out. This reads the
 * flattening back.
 *
 * Three rules hold throughout, and they are what keep it from being a
 * gimmick.
 *
 * **It never replaces the output.** The text stays exactly where it was. What
 * appears is an extra view of the same thing, and it can be dismissed. A
 * terminal that swallowed what a command printed would be unusable the first
 * time it got something wrong.
 *
 * **It is deterministic.** These are parsers, not guesses. No model is asked
 * what the output might be, because a wrong table presented confidently is
 * worse than a wall of text — text is at least honestly text.
 *
 * **It refuses more than it accepts.** Every recogniser returns null the
 * moment the output stops looking like what it expects, and the panel simply
 * does not appear. Showing nothing is always available and always correct;
 * showing the wrong thing is neither.
 */

/** A command that finished, and what it printed. */
export interface Completion {
  command: string;
  /** Zero means it worked. */
  code: number;
  /** Only what this command printed — not the prompt, not the command line. */
  output: string;
  /** Where it ran. Sent by the shell, because `ls` here is not `ls` there. */
  cwd: string;
}

export type Align = "left" | "right";

export interface Column {
  key: string;
  label: string;
  align?: Align;
  /** Figures and paths line up only in a monospaced column. */
  mono?: boolean;
  /** Dropped first when there is not enough width. */
  secondary?: boolean;
}

export interface Row {
  /** Stable within one view, for React and for selection. */
  id: string;
  cells: Record<string, string>;
  /** Colours the row's marker. A fact about the row, not decoration. */
  tone?: "good" | "warn" | "bad" | "muted";
}

/** A meter is a proportion with a name — a disk, a quota, a budget. */
export interface Meter {
  label: string;
  used: number;
  total: number;
  note?: string;
  /** Already-formatted, because only the parser knows the units. */
  usedText: string;
  totalText: string;
}

export interface Entry {
  id: string;
  title: string;
  /** Short facts shown under the title, in order. */
  meta: string[];
  body?: string;
}

export interface Fact {
  label: string;
  value: string;
}

export type View =
  | { kind: "table"; columns: Column[]; rows: Row[] }
  | { kind: "meters"; meters: Meter[] }
  | { kind: "timeline"; entries: Entry[] }
  | { kind: "facts"; facts: Fact[]; note?: string }
  | { kind: "json"; text: string };

/**
 * Something a person can do next, offered as a command.
 *
 * Every action **types a command into the terminal** rather than running
 * something the user cannot see. That is the whole safety model: a panel that
 * could quietly run `docker stop` would be a panel you had to trust, and this
 * one only has to be read. What it does is exactly what you would have typed.
 */
export interface Action {
  /** The single key that also triggers it. Shown in brackets. */
  key: string;
  label: string;
  /** Written into the terminal. Not run — the person still presses Enter. */
  command: string;
}

export interface Recognised {
  /** Which recogniser produced this. Used as a stable id, never shown. */
  kind: string;
  title: string;
  subtitle?: string;
  view: View;
  actions?: Action[];
}

export type Recogniser = (completion: Completion) => Recognised | null;

/** The command, split into its program and its arguments. */
export function words(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/**
 * Whether a command is the one named, allowing for how people write it.
 *
 * `git log`, `/usr/bin/git log` and `sudo git log` are the same question. The
 * path is dropped and a leading `sudo` is stepped over; anything else — a
 * pipe, a redirect, a `&&` — means the output is not this command's alone,
 * and is refused by `isPlain`.
 */
export function isCommand(command: string, ...expected: string[]): boolean {
  let parts = words(command);
  if (parts[0] === "sudo") parts = parts.slice(1);
  if (parts.length === 0) return false;

  const program = parts[0].split("/").pop() ?? "";
  const rest = [program, ...parts.slice(1)];

  return expected.every((want, i) => rest[i] === want);
}

/**
 * Whether the output belongs to this command alone.
 *
 * A pipe, a redirect or a `&&` means what was printed came from somewhere
 * else — `docker ps | grep api` prints grep's output, and parsing it as
 * docker's would be reading the wrong thing confidently. Refused rather than
 * attempted.
 */
export function isPlain(command: string): boolean {
  return !/[|><;&`$(]/.test(command);
}

/** The arguments that are not flags. */
export function operands(command: string): string[] {
  let parts = words(command);
  if (parts[0] === "sudo") parts = parts.slice(1);
  return parts.slice(1).filter((p) => !p.startsWith("-"));
}

/** Whether a flag was given, long or short. `-la` contains `a`. */
export function hasFlag(command: string, short: string, long?: string): boolean {
  const parts = words(command).slice(1);
  return parts.some(
    (p) =>
      (long !== undefined && p === long) ||
      (/^-[^-]/.test(p) && p.slice(1).includes(short)),
  );
}

/**
 * Output as lines, with the blank ones at either end removed.
 *
 * Control characters go too. A terminal consumes most escape sequences before
 * they ever reach a buffer, but not all of them survive the trip intact —
 * a backspace from an autosuggestion redraw, a stray keypad-mode escape — and
 * a single one at the start of a line is enough to stop a parser recognising
 * it. Found by driving a real zsh: one commit in three was silently missing
 * because its line began with an escape.
 *
 * Tabs are kept, because column-aligned output sometimes uses them.
 */
export function lines(output: string): string[] {
  const all = output
    .split("\n")
    // eslint-disable-next-line no-control-regex
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+$/, ""));
  while (all.length > 0 && all[0].trim() === "") all.shift();
  while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();
  return all;
}

/**
 * Split a row on runs of two or more spaces.
 *
 * The convention every column-aligned CLI follows, and the reason it works: a
 * single space can be inside a value — a container image, a file name, a
 * commit subject — and two in a row almost never are.
 */
export function columnsOf(line: string): string[] {
  return line.trim().split(/\s{2,}/).filter((p) => p !== "");
}

/**
 * Where each column starts, measured from a header line.
 *
 * Splitting on runs of spaces is nearly right and fails in one specific way:
 * a row with an empty column has one field fewer, so everything after it
 * shifts left and the values land under the wrong headings. `docker ps` with
 * a container that publishes no ports does exactly this, and the result still
 * looks like a table — which is the worst kind of wrong.
 *
 * Column-aligned output is fixed-width, so the honest way to read it is by
 * position: find each heading in the header line, and slice every row at the
 * same offsets. An empty column then reads as empty, which is what it is.
 */
export function headerOffsets(header: string, labels: string[]): number[] | null {
  const offsets: number[] = [];
  let from = 0;

  for (const label of labels) {
    const at = header.indexOf(label, from);
    if (at === -1) return null;
    offsets.push(at);
    from = at + label.length;
  }
  return offsets;
}

/**
 * Slice a row at the offsets a header gave.
 *
 * The last column runs to the end of the line, because it is where the
 * variable-length thing usually is — a command, a name, a mount point.
 */
export function sliceAt(line: string, offsets: number[]): string[] {
  return offsets.map((start, i) => {
    const end = i + 1 < offsets.length ? offsets[i + 1] : line.length;
    return line.slice(start, end).trim();
  });
}
