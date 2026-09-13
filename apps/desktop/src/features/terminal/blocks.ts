import type { CommandBlock } from "./marks";

/**
 * A command and its output, as one thing you can act on.
 *
 * A terminal is a river of text, and everything anyone wants to do with it is
 * about one command: copy what that printed, run it again, ask why it failed.
 * Doing any of those today means dragging a mouse across the output and
 * hoping the edges landed right — which they usually do not, because the
 * prompt above and the prompt below are the same colour as everything else.
 *
 * The hard part of blocks is knowing where a command's output truly begins.
 * This app already knows, exactly, from the shell itself — see `marks`. What
 * is here is the small amount of arithmetic that turns a marked block into
 * something a person can point at, kept apart from the drawing so it can be
 * tested without a terminal.
 */

export type BlockTone = "ok" | "failed" | "running";

/** How a block is marked in the gutter. */
export function toneOf(block: CommandBlock): BlockTone {
  if (!block.end) return "running";
  // A shell that reported no status is not a shell reporting failure. Marking
  // it red would cry wolf on every command under a shell with no integration.
  return block.exitCode !== null && block.exitCode !== 0 ? "failed" : "ok";
}

/**
 * How many rows the mark should cover, given where the block sits.
 *
 * From the prompt to the end, inclusive, so the mark spans the command and
 * everything it printed. One row minimum: a command that printed nothing
 * still happened and still has to be clickable.
 */
export function rowsOf(block: CommandBlock): number {
  const from = block.prompt.line;
  const to = block.end?.line ?? block.output?.line ?? from;
  return Math.max(1, to - from + 1);
}

/**
 * Whether a block is worth marking at all.
 *
 * The first `D` of a session arrives before any command has run — the shells
 * report unconditionally, and a consumer that sees `D` without a `C` already
 * knows to ignore it. A mark against that would be a mark against nothing.
 */
export function isReal(block: CommandBlock): boolean {
  return block.output !== null || block.command.trim() !== "";
}

/** What can be done with a block, given what is known about it. */
export interface BlockActions {
  /** There is text to copy. */
  copyOutput: boolean;
  /** The shell said what was typed, so it can be copied or run again. */
  copyCommand: boolean;
  rerun: boolean;
  /** Worth asking about: it failed, or it printed something. */
  ask: boolean;
}

export function actionsFor(block: CommandBlock, output: string): BlockActions {
  const named = block.command.trim() !== "";
  return {
    copyOutput: output.trim() !== "",
    copyCommand: named,
    rerun: named,
    ask: named && (toneOf(block) === "failed" || output.trim() !== ""),
  };
}

/**
 * How long a command took, in the roughest unit that is still true.
 *
 * Shown on the menu so the block says what it cost without anyone having to
 * remember. Null while it is still running, which reads as "still going"
 * rather than as zero.
 */
export function tookOf(block: CommandBlock): number | null {
  if (block.startedAt === null) return null;
  return Math.max(0, (block.finishedAt ?? Date.now()) - block.startedAt);
}

export function tookText(took: number | null): string {
  if (took === null) return "still running";
  if (took < 1000) return `${Math.max(1, Math.round(took))}ms`;
  if (took < 60_000) return `${(took / 1000).toFixed(1)}s`;
  const minutes = Math.floor(took / 60_000);
  return `${minutes}m ${Math.round((took % 60_000) / 1000)}s`;
}

/**
 * What a block copies as, when both halves are wanted.
 *
 * The command is written as it would be typed, so pasting the result into a
 * chat or an issue gives somebody the whole story — what was run and what
 * came back — rather than output with no question attached to it.
 */
export function transcript(command: string, output: string): string {
  const said = command.trim();
  const back = output.replace(/\s+$/, "");
  if (!said) return back;
  return back ? `$ ${said}\n${back}` : `$ ${said}`;
}

/**
 * The lines a block's output occupies, for reading them out of a buffer.
 *
 * Null when the shell never said where output began — under a shell with no
 * integration there is no honest answer, and guessing is what the marks exist
 * to replace.
 */
export function outputRows(block: CommandBlock): { from: number; to: number } | null {
  if (!block.output) return null;
  // `end` is where the prompt that followed began, so the last row of output
  // is the one before it. A command whose output ended on the same row it
  // started reads as a single row rather than as none.
  const to = block.end ? Math.max(block.output.line, block.end.line - 1) : block.output.line;
  return { from: block.output.line, to };
}

/**
 * What to ask the assistant about a command.
 *
 * Written as a question a person would ask, with the command and what came
 * back attached — the assistant is given the transcript rather than a
 * description of it, because "it failed" is not something anybody can debug.
 *
 * A failed command asks why. One that worked asks what it means, which is
 * the other reason to point at a command you have already run.
 */
export function questionFor(block: CommandBlock, output: string): string {
  const said = transcript(block.command, output);
  return toneOf(block) === "failed"
    ? `This failed with exit ${block.exitCode}. What went wrong, and how do I fix it?\n\n${said}`
    : `What is this telling me?\n\n${said}`;
}

