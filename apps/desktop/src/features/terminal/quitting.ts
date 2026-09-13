/**
 * What to say when the window is asked to close with work in progress.
 *
 * Two kinds of work, and the question has to name whichever is actually
 * there: unsaved files, terminals mid-command, or both. A dialog that said
 * "1 unsaved file" while the real reason was a four-minute build would be
 * asking about the wrong thing, and one that always said "work in progress"
 * would never say what to go and look at.
 *
 * Plain functions rather than a component, so every wording is a test rather
 * than something anyone has to trigger a quit to see.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function quitTitle(unsaved: number, running: number): string {
  if (unsaved > 0 && running > 0) {
    return `${plural(unsaved, "unsaved file", "unsaved files")} and ${plural(
      running,
      "command",
      "commands",
    )} still running`;
  }
  if (unsaved > 0) return plural(unsaved, "unsaved file", "unsaved files");
  return `${plural(running, "command", "commands")} still running`;
}

export function quitBody(unsaved: number, running: number): string {
  const lost =
    running > 0
      ? "A shell is a child of this window, so anything still going stops when it closes."
      : "";
  const disk = unsaved > 0 ? "Closing now throws away everything that is not on disk." : "";
  return [disk, lost].filter(Boolean).join(" ");
}
