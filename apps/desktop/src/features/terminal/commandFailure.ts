import type { ProviderStatus } from "../../platform/types";

/**
 * When a command fails, and what to do about it.
 *
 * The shell reports a non-zero exit through OSC 1337 — see
 * `jky-pty::integration` for the hook that emits it. Nothing is reported when
 * a command succeeds, so anything arriving here is already a failure.
 *
 * **Nothing is sent to a model until someone asks.** The offer that appears
 * under a failed command is drawn from what the terminal already knows and
 * costs nothing; a request is built only when one of the buttons is pressed.
 * That is the whole token policy, and it is the reason the offer can appear
 * every time without being expensive.
 *
 * What a request carries is bounded three ways: the command, the tail of the
 * output, and an instruction that asks for a short answer. A terminal is not
 * a chat window, and an essay under a failed `git push` is worse than three
 * sentences whether or not it costs anything.
 */

/** Marker the shell's prompt hook emits inside an OSC 1337 sequence. */
export const DONE_PREFIX = "JKYDone=";

/** The longest command line kept. Shown in the panel and sent to the model. */
const MAX_COMMAND = 256;

/** The most output sent with a request. */
const MAX_OUTPUT = 700;

/**
 * A command that finished.
 *
 * Every command, not only the ones that failed — see `jky-pty::integration`
 * for why that changed. Two things read this: the offer of help under a
 * broken command, and the panel that shows what a working one produced.
 */
export interface CommandDone {
  code: number;
  /** Where it ran. `ls` here is a different answer from `ls` there. */
  cwd: string;
  command: string;
}

/** What the shell hook builds, kept here so both ends agree. Used by tests. */
export function encodeDone(code: number, cwd: string, command: string): string {
  const bytes = new TextEncoder().encode(`${code}\n${cwd}\n${command}`);
  return DONE_PREFIX + btoa(String.fromCharCode(...bytes));
}

/**
 * Read a completion out of an OSC payload, or null if it is not one of ours.
 *
 * OSC 1337 is shared, application-defined space and other programs put their
 * own things in it, so anything unrecognised is left alone rather than
 * guessed at — consuming it would swallow another program's sequence.
 */
export function decodeDone(payload: string): CommandDone | null {
  if (!payload.startsWith(DONE_PREFIX)) return null;

  const encoded = payload.slice(DONE_PREFIX.length).trim();
  if (!encoded) return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);

    // Exit code, working directory, command — and the command may itself
    // contain newlines, so it takes everything after the second one.
    const first = text.indexOf("\n");
    if (first === -1) return null;
    const second = text.indexOf("\n", first + 1);
    if (second === -1) return null;

    const code = Number(text.slice(0, first).trim());
    if (!Number.isInteger(code)) return null;

    return {
      code,
      cwd: text.slice(first + 1, second),
      command: text.slice(second + 1).trim().slice(0, MAX_COMMAND),
    };
  } catch {
    return null;
  }
}

/**
 * The end of the output, blank lines removed.
 *
 * The end, because what went wrong is the last thing printed and the first
 * thing printed is usually progress nobody needs — sending the head would
 * spend the budget on the least useful half. Blank lines go because a
 * terminal buffer is mostly padding and none of it is meaning.
 */
export function outputTail(text: string, limit: number): string {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");

  const joined = lines.join("\n");
  return joined.length <= limit ? joined : joined.slice(-limit);
}

export type HelpKind = "explain" | "fix" | "commands";

/** The choices offered under a failed command, in the order they are shown. */
export const HELP_KINDS: { id: HelpKind; label: string; key: string }[] = [
  { id: "explain", label: "Explain", key: "1" },
  { id: "fix", label: "Fix", key: "2" },
  { id: "commands", label: "Show commands", key: "3" },
];

/**
 * What each button asks for.
 *
 * Each one asks for something small and something different. If they asked
 * the same question in different words, four buttons would be one button with
 * extra steps — and every one of them would cost the same tokens.
 */
const ASK: Record<HelpKind, string> = {
  explain:
    "Say why this failed, in at most three short sentences. No preamble, no restating the command.",
  fix: "Give the single command most likely to fix this, on its own line, then one short line saying what it does. Nothing else.",
  commands:
    "List at most three commands that would diagnose or fix this, one per line, each with a note of at most eight words. Nothing else.",
};

export interface HelpRequest {
  text: string;
}

/**
 * Build the one message sent for a choice.
 *
 * Everything in it is bounded, and the instruction asks for a bounded answer.
 * This is the only place tokens are spent, and it is reached only by someone
 * pressing a button.
 */
export function helpRequest(
  kind: HelpKind,
  failure: CommandDone,
  output: string,
): HelpRequest {
  const tail = outputTail(output, MAX_OUTPUT);
  const parts = [
    ASK[kind],
    "",
    `Command: ${failure.command || "(unknown)"}`,
    `Exit code: ${failure.code}`,
  ];
  if (tail) parts.push("Output:", tail);

  return { text: parts.join("\n") };
}

/**
 * The providers that could actually answer.
 *
 * "No key anywhere" is not the same question as "nothing to ask": a local
 * runtime needs no credential, so one that is configured counts even with an
 * empty vault.
 */
export function usableProviders(all: ProviderStatus[]): ProviderStatus[] {
  return all.filter((p) => p.connected || !p.requiresKey);
}

/**
 * A command's own output, taken from the lines the terminal drew.
 *
 * The region between two completion reports holds three things: the prompt,
 * the command as it was typed, and then what the command printed. Only the
 * third is the output, and the first two have to go — a prompt at the top of
 * a table is a row that is not one.
 *
 * The command is found rather than assumed to be on the first line, because
 * prompts wrap and so do long commands. Lines are accumulated until the text
 * typed appears in them; whatever follows is the output.
 *
 * When the command cannot be found the whole region is returned rather than a
 * guess at how much to drop. A recogniser handed a prompt line usually
 * refuses — the header is not where it expects — and refusing is the safe
 * direction. Dropping the wrong number of lines is not.
 */
export function outputOf(region: string[], command: string): string {
  const needle = command.trim();
  if (needle === "") return region.join("\n").trim();

  let seen = "";
  for (let i = 0; i < region.length; i += 1) {
    seen += region[i];
    if (seen.includes(needle)) {
      return region
        .slice(i + 1)
        .join("\n")
        .replace(/^\n+|\s+$/g, "");
    }
    // Bounded: only enough tail is kept to span a wrap of the command.
    seen = seen.slice(-Math.max(needle.length * 2, 256));
  }

  return region.join("\n").trim();
}
