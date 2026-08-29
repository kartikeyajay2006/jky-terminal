/**
 * Commands the shell sends back into the app.
 *
 * The listings — `jky notes`, `jky todos` — are read-only by construction:
 * Rust renders them to files and the shell does nothing cleverer than `cat`
 * the right one. That is a good arrangement for reading and no help at all
 * for writing, because a file the shell reads cannot carry a new note back.
 *
 * So writes ride the same escape sequence `jky ask` already uses. The shell
 * emits an OSC payload, the terminal decodes it here, and the app performs
 * the action and prints the outcome straight back onto the screen. No socket,
 * no port, and nothing that has to know where the app is.
 *
 * The payload is base64-encoded JSON. Base64 because a note body containing a
 * quote, a newline, or the sequence terminator itself must not be able to
 * break out; JSON because a command has arguments and splitting on a
 * separator would fail the first time someone wrote one into a note.
 */

/** Marker the shell's write commands emit inside an OSC 1337 sequence. */
export const CMD_PREFIX = "JKYCmd=";

/** The escape character every ANSI sequence starts with. */
const ESC = "\u001b";

export interface ShellCommand {
  verb: string;
  args: string[];
}

/**
 * Decode an OSC payload into a command, or null if it is not one of ours.
 *
 * Anything malformed is ignored rather than guessed at. OSC 1337 is shared,
 * application-defined space and other programs put their own things in it.
 */
export function decodeCommand(payload: string): ShellCommand | null {
  if (!payload.startsWith(CMD_PREFIX)) return null;

  const encoded = payload.slice(CMD_PREFIX.length).trim();
  if (!encoded) return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v.verb !== "string" || !v.verb) return null;
    if (!Array.isArray(v.args)) return null;
    if (!v.args.every((a) => typeof a === "string")) return null;

    return { verb: v.verb, args: v.args as string[] };
  } catch {
    return null;
  }
}

/** For tests and for the shell-side encoder to agree with. */
export function encodeCommand(command: ShellCommand): string {
  const json = JSON.stringify(command);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${CMD_PREFIX}${btoa(binary)}`;
}

// --- what a command produces ------------------------------------------------

export interface CommandResult {
  ok: boolean;
  /** One line, printed back into the terminal. */
  message: string;
}

export function ok(message: string): CommandResult {
  return { ok: true, message };
}

export function fail(message: string): CommandResult {
  return { ok: false, message };
}

/**
 * The result as the terminal should print it.
 *
 * A leading newline because the shell's own prompt is already on the line,
 * and a trailing one so the next prompt starts clean. Colour comes from the
 * live accent token, the same way the banner's does.
 */
export function renderResult(result: CommandResult, accent: string): string {
  const reset = `${ESC}[0m`;
  const tint = result.ok ? colour(accent) : `${ESC}[38;2;255;77;106m`;
  const glyph = result.ok ? "✓" : "✗";
  return `\r\n  ${tint}${glyph}${reset} ${result.message}\r\n`;
}

function colour(hex: string): string {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length !== 6 || !/^[0-9a-f]{6}$/i.test(clean)) return `${ESC}[32m`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${ESC}[38;2;${r};${g};${b}m`;
}

/**
 * Which record a handle refers to.
 *
 * The listings number from one, in the order they are printed — and that
 * order is not always insertion order: reminders are listed by time of day.
 * Resolving a handle has to use the same ordering the listing used, or
 * `jky reminder done 1` ticks off whichever reminder happens to be first in
 * the file rather than the one the user is looking at.
 */
export function resolveHandle<T>(
  items: T[],
  handle: string,
  order?: (a: T, b: T) => number,
): T | null {
  if (!/^\d+$/.test(handle.trim())) return null;
  const n = Number(handle.trim());
  if (n < 1) return null;

  const sorted = order ? [...items].sort(order) : items;
  return sorted[n - 1] ?? null;
}

/** The order `render_reminders` prints them in: by time of day. */
export function byReminderTime<T extends { at: string }>(a: T, b: T): number {
  return a.at.localeCompare(b.at);
}

/** `HH:MM`, the only shape a reminder's time may take. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}
