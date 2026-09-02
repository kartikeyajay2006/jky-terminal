import { recogniseFileAction, recogniseLs } from "./files";
import { recogniseGitLog, recogniseGitStatus } from "./git";
import { recogniseDf, recogniseDockerPs, recogniseJson, recognisePs } from "./machine";
import type { Completion, Recognised, Recogniser } from "./types";

export * from "./types";

/**
 * Every recogniser, in the order they are asked.
 *
 * Order matters in one direction only: the ones that know a command come
 * before the one that only knows a shape. `kubectl get pods -o json` prints
 * JSON, and a kubectl recogniser would know more about it than "this is
 * JSON" — so the shape is asked last.
 *
 * The first that says yes wins, and any of them may say nothing.
 */
export const RECOGNISERS: Recogniser[] = [
  recogniseGitStatus,
  recogniseGitLog,
  recogniseDockerPs,
  recogniseDf,
  recognisePs,
  recogniseLs,
  recogniseFileAction,
  // Last, because it recognises a shape rather than a command, and anything
  // that knows which command ran knows more than that.
  recogniseJson,
];

/** How much output is worth attempting. */
const MAX_OUTPUT = 512 * 1024;

/**
 * Look at a finished command, and say what it could be shown as.
 *
 * Null is the ordinary answer. Most commands are not tables, and a terminal
 * that produced a panel for every one of them would be a terminal you fought
 * rather than used.
 */
export function recognise(completion: Completion): Recognised | null {
  // A command with no name is the shell reporting the prompt it drew before
  // anything was typed.
  if (completion.command.trim() === "") return null;

  // Enormous output is a log, a dump or a stream, and none of those becomes a
  // table. Deciding that by parsing half a megabyte would be time spent
  // learning what the size already said.
  if (completion.output.length > MAX_OUTPUT) return null;

  for (const recogniser of RECOGNISERS) {
    try {
      const found = recogniser(completion);
      if (found) return found;
    } catch {
      // A recogniser that threw met output it did not expect, which is the
      // case it should have returned null for. Treated the same way: the
      // panel does not appear and the terminal is untouched. The one thing
      // that must never happen is a terminal breaking over a panel that was
      // only ever an extra.
    }
  }
  return null;
}
