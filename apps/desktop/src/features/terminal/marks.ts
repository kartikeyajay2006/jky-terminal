/**
 * Semantic marks: knowing where a command's output actually starts.
 *
 * The shell reports four moments through OSC 133 — a prompt beginning (`A`),
 * a command's output beginning (`C`), and the command finishing with a status
 * (`D`). See `crates/jky-pty/src/integration.rs` for what emits them.
 *
 * The point is exactness. Until now the boundary between a command and its
 * output was found by searching the screen for the command's own text, which
 * is a good guess and a guess nonetheless: it lands in the wrong place when a
 * command prints something resembling itself (`grep`, `history`, `echo`), when
 * the prompt wraps, or when the command was edited before being run. `C` is
 * the shell saying where output begins, so nothing has to be inferred.
 *
 * Nothing here imports xterm. Positions arrive as `LineRef`, which xterm's own
 * markers satisfy and a plain object also satisfies, so all of this is
 * testable without a terminal.
 */

/** Something that knows which line it is on, and keeps knowing as text scrolls. */
export interface LineRef {
  readonly line: number;
}

export type MarkKind = "prompt" | "output" | "done";

export interface Mark {
  kind: MarkKind;
  /** Present only on `done`, and only when the shell reported one. */
  exitCode: number | null;
}

/** One command, from the prompt that invited it to the status it returned. */
export interface CommandBlock {
  /** Where the prompt began. The line a "jump to previous command" lands on. */
  prompt: LineRef;
  /** Where output began. Null when the shell reported no `C`. */
  output: LineRef | null;
  /** Where it finished. Null while it is still running. */
  end: LineRef | null;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * Read an OSC 133 payload.
 *
 * Payloads carry optional parameters after the kind — `D;1`, but also
 * `A;aid=7` from shells that track sub-shell identity. Everything past the
 * kind is ignored except `D`'s status, so an unfamiliar parameter is
 * survivable rather than fatal.
 */
export function parseMark(payload: string): Mark | null {
  const [kind, ...rest] = payload.split(";");
  switch (kind) {
    case "A":
      return { kind: "prompt", exitCode: null };
    case "C":
      return { kind: "output", exitCode: null };
    case "D": {
      const code = Number.parseInt(rest[0] ?? "", 10);
      return { kind: "done", exitCode: Number.isFinite(code) ? code : null };
    }
    // `B` is the prompt/input boundary. This app does not emit it, because
    // emitting it means rewriting the user's PS1; a shell configured by
    // another terminal may still send it, and it is not an error.
    case "B":
      return null;
    default:
      return null;
  }
}

/**
 * The commands on screen, in the order they ran.
 *
 * Blocks are capped: a terminal open for a day is thousands of commands, and
 * the only ones anybody navigates to are the recent ones.
 */
export class MarkTracker {
  private readonly blocks: CommandBlock[] = [];
  private open: CommandBlock | null = null;

  constructor(private readonly limit = 500) {}

  /** A prompt was drawn. Any command still open is abandoned, not completed. */
  prompt(at: LineRef, now: number): void {
    // A prompt arriving with a command still open means the command produced
    // no `D` — a shell killed mid-run, or one whose integration is partial.
    // Closing it here keeps the list ordered rather than leaving a block that
    // swallows everything after it.
    this.open = { prompt: at, output: null, end: null, exitCode: null, startedAt: now, finishedAt: null };
    this.blocks.push(this.open);
    while (this.blocks.length > this.limit) this.blocks.shift();
  }

  /** Output began. This is the line the guessing used to try to find. */
  output(at: LineRef, now: number): void {
    if (!this.open) return;
    this.open.output = at;
    this.open.startedAt = now;
  }

  /** The command finished. */
  done(at: LineRef, exitCode: number | null, now: number): void {
    if (!this.open) return;
    this.open.end = at;
    this.open.exitCode = exitCode;
    this.open.finishedAt = now;
    this.open = null;
  }

  /** The command currently running, if the shell has told us one is. */
  get current(): CommandBlock | null {
    return this.open;
  }

  get list(): readonly CommandBlock[] {
    return this.blocks;
  }

  /** The most recently finished command. */
  last(): CommandBlock | null {
    for (let i = this.blocks.length - 1; i >= 0; i -= 1) {
      if (this.blocks[i].end) return this.blocks[i];
    }
    return null;
  }

  /**
   * The prompt above `line`, for jumping backwards.
   *
   * Strictly above, so repeating the jump keeps moving rather than sticking on
   * the prompt it just landed on.
   */
  previousPrompt(line: number): number | null {
    let best: number | null = null;
    for (const b of this.blocks) {
      if (b.prompt.line < line && (best === null || b.prompt.line > best)) best = b.prompt.line;
    }
    return best;
  }

  /** The prompt below `line`, for jumping forwards. */
  nextPrompt(line: number): number | null {
    let best: number | null = null;
    for (const b of this.blocks) {
      if (b.prompt.line > line && (best === null || b.prompt.line < best)) best = b.prompt.line;
    }
    return best;
  }

  /** Forget everything, as a cleared screen should. */
  reset(): void {
    this.blocks.length = 0;
    this.open = null;
  }
}
