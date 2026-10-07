import { COMPLETIONS, run, words } from "./commands";
import type { Result, ShellContext } from "./types";

/**
 * The line editor and history in front of the commands: what a shell does
 * before it runs anything. Pure state — the view feeds it keys and draws it.
 */
export class Shell {
  line = "";
  cursor = 0;
  readonly cwd = "~/acme/api";
  readonly branch = "main";
  private history: string[] = [];
  private browsing = -1;
  private draft = "";

  constructor(private readonly ctx: ShellContext) {}

  insert(text: string) {
    this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor);
    this.cursor += text.length;
  }

  backspace() {
    if (this.cursor === 0) return;
    this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
    this.cursor--;
  }

  deleteForward() {
    this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
  }

  /** Ctrl+W: the word before the cursor. */
  deleteWord() {
    const before = this.line.slice(0, this.cursor).replace(/\S+\s*$/, "");
    this.line = before + this.line.slice(this.cursor);
    this.cursor = before.length;
  }

  /** Ctrl+U: everything before the cursor. */
  killToStart() {
    this.line = this.line.slice(this.cursor);
    this.cursor = 0;
  }

  left() {
    this.cursor = Math.max(0, this.cursor - 1);
  }

  right() {
    this.cursor = Math.min(this.line.length, this.cursor + 1);
  }

  home() {
    this.cursor = 0;
  }

  end() {
    this.cursor = this.line.length;
  }

  set(text: string) {
    this.line = text;
    this.cursor = text.length;
  }

  /** ↑: the previous command, remembering what you had half-typed. */
  up() {
    if (this.history.length === 0) return;
    if (this.browsing === -1) {
      this.draft = this.line;
      this.browsing = this.history.length;
    }
    this.browsing = Math.max(0, this.browsing - 1);
    this.set(this.history[this.browsing]);
  }

  /** ↓: forward again, back to the draft at the end. */
  down() {
    if (this.browsing === -1) return;
    this.browsing++;
    if (this.browsing >= this.history.length) {
      this.browsing = -1;
      this.set(this.draft);
    } else {
      this.set(this.history[this.browsing]);
    }
  }

  /**
   * Tab. A single match completes, with a trailing space; several complete
   * as far as they agree and are returned to be listed — what bash does on
   * a second Tab, done on the first because nobody here knows to press it
   * twice.
   */
  complete(): string[] {
    const before = this.line.slice(0, this.cursor);
    const parts = words(before);
    const typingNew = before.endsWith(" ") || before.length === 0;
    const partial = typingNew ? "" : (parts.pop() ?? "");
    const key = parts.join(" ");
    const options = (COMPLETIONS[key] ?? []).filter((o) => o.startsWith(partial));
    if (options.length === 0) return [];
    if (options.length === 1) {
      this.insert(`${options[0].slice(partial.length)} `);
      return [];
    }
    let common = options[0];
    for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
    if (common.length > partial.length) this.insert(common.slice(partial.length));
    return options;
  }

  /** Enter: runs the line, files it in history, and clears the editor. */
  submit(): { input: string; result: Result } {
    const input = this.line;
    if (input.trim() && this.history[this.history.length - 1] !== input) this.history.push(input);
    this.browsing = -1;
    this.draft = "";
    this.set("");
    return { input, result: run(input, this.ctx, this.cwd) };
  }

  /** Ctrl+C: abandon the line, as a shell does. */
  interrupt(): string {
    const input = this.line;
    this.browsing = -1;
    this.set("");
    return input;
  }
}
