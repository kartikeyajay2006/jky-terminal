import { describe, expect, it } from "vitest";
import { Terminal as Xterm } from "@xterm/xterm";

/**
 * What the terminal underneath can actually do.
 *
 * A dependency bump is a number in a file until something asserts the feature
 * arrived with it. These ask the real xterm rather than the mock the other
 * terminal tests use, by the only method that is not a guess: sending it the
 * query a program would send, and reading the answer it gives back.
 */

/** Ask the terminal what it makes of a private mode, and hear its reply. */
async function askAboutMode(mode: number): Promise<string> {
  // Never opened. The parser is what answers a query, and attaching a
  // renderer needs a canvas jsdom does not have — so this asks the half of
  // the terminal the question is actually about.
  const term = new Xterm({ allowProposedApi: true });

  const replies: string[] = [];
  term.onData((d) => replies.push(d));

  // DECRQM: "what is the state of private mode N?"
  term.write(`\x1b[?${mode}$p`);
  await new Promise((r) => setTimeout(r, 60));

  term.dispose();
  return replies.join("");
}

/** Write through xterm's real parser, then let its asynchronous write settle. */
async function write(term: Xterm, data: string): Promise<void> {
  await new Promise<void>((resolve) => term.write(data, resolve));
}

/**
 * DECRPM answers `CSI ? mode ; state $ y`, and state 0 is the one that
 * matters: it means the terminal does not know the mode at all.
 */
const stateOf = (reply: string, mode: number): number | null => {
  const m = new RegExp(`\\x1b\\[\\?${mode};(\\d+)\\$y`).exec(reply);
  return m ? Number(m[1]) : null;
};

describe("the terminal underneath", () => {
  /*
   * Synchronized output, DEC private mode 2026.
   *
   * A program that redraws a whole screen — vim, htop, an assistant painting
   * a panel — brackets the redraw in this mode, and a terminal that honours
   * it shows the finished frame instead of the half-drawn one. Without it you
   * see tearing on every repaint, which is most of what a full-screen program
   * does.
   *
   * It arrived in xterm.js 6.0, which is why this app is on it.
   */
  it("honours synchronized output, so a redraw is not shown half-done", async () => {
    const reply = await askAboutMode(2026);
    const state = stateOf(reply, 2026);

    expect(state, `no DECRPM answer for 2026 — got ${JSON.stringify(reply)}`).not.toBeNull();
    // 0 means "I have never heard of this mode", which is what 5.5 said.
    expect(state, "the terminal does not know mode 2026").not.toBe(0);
  });

  // A mode nobody implements, to prove the question above can fail. Without
  // this, a query that silently answered nothing would look like a pass.
  it("says so when it does not know a mode", async () => {
    const reply = await askAboutMode(64123);
    const state = stateOf(reply, 64123);
    expect(state === null || state === 0).toBe(true);
  });

  it("keeps an OSC 8 hyperlink out of the visible command output", async () => {
    const term = new Xterm({ cols: 80, rows: 3, allowProposedApi: true });
    const esc = String.fromCharCode(27);
    await write(term, `open ${esc}]8;;https://example.test${esc}\\docs${esc}]8;;${esc}\\ now`);

    const line = term.buffer.active.getLine(0)?.translateToString(true) ?? "";
    term.dispose();
    expect(line).toBe("open docs now");
  });

  it("keeps wide Unicode glyphs intact in the terminal grid", async () => {
    const term = new Xterm({ cols: 80, rows: 3, allowProposedApi: true });
    await write(term, "build ✓ 東京 🚀");

    const line = term.buffer.active.getLine(0)?.translateToString(true) ?? "";
    term.dispose();
    expect(line).toBe("build ✓ 東京 🚀");
  });
});
