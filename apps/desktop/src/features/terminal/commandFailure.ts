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
export const EXIT_PREFIX = "JKYExit=";

/** The longest command line kept. Shown in the panel and sent to the model. */
const MAX_COMMAND = 256;

/** The most output sent with a request. */
const MAX_OUTPUT = 700;

export interface CommandFailure {
  /** Never zero: success is not reported. */
  code: number;
  command: string;
}

/** What the shell hook builds, kept here so both ends agree. Used by tests. */
export function encodeFailure(code: number, command: string): string {
  const bytes = new TextEncoder().encode(`${code}\n${command}`);
  return EXIT_PREFIX + btoa(String.fromCharCode(...bytes));
}

/**
 * Read a failure out of an OSC payload, or null if it is not one of ours.
 *
 * OSC 1337 is shared, application-defined space and other programs put their
 * own things in it, so anything unrecognised is left alone rather than
 * guessed at — consuming it would swallow another program's sequence.
 */
export function decodeFailure(payload: string): CommandFailure | null {
  if (!payload.startsWith(EXIT_PREFIX)) return null;

  const encoded = payload.slice(EXIT_PREFIX.length).trim();
  if (!encoded) return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);

    const newline = text.indexOf("\n");
    if (newline === -1) return null;

    const code = Number(text.slice(0, newline).trim());
    // A zero here means something other than our hook is emitting this.
    if (!Number.isInteger(code) || code === 0) return null;

    return {
      code,
      command: text.slice(newline + 1).trim().slice(0, MAX_COMMAND),
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
  failure: CommandFailure,
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
