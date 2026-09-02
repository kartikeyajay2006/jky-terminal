import { describe, expect, it } from "vitest";
import { recogniseGitLog, recogniseGitStatus } from "./git";
import type { Completion } from "./types";

const done = (command: string, output = "", code = 0): Completion => ({
  command,
  output,
  code,
  cwd: "/repo",
});

describe("recogniseGitStatus", () => {
  const SHORT = ` M src/main.rs
M  README.md
?? notes/
D  old.txt
MM both.rs`;

  it("reads the short format", () => {
    const out = recogniseGitStatus(done("git status -s", SHORT))!;
    expect(out.view.kind).toBe("table");
    if (out.view.kind !== "table") return;
    expect(out.view.rows).toHaveLength(5);
    expect(out.view.rows[0].cells.path).toBe("src/main.rs");
  });

  /*
   * The two columns are different questions.
   *
   * Left is the index, right is the working tree — which is the whole reason
   * anyone runs `git status`. `MM` means you staged a change and then made
   * another one, and a panel that merged the columns would lose that.
   */
  it("keeps staged and unstaged apart", () => {
    const out = recogniseGitStatus(done("git status -s", SHORT))!;
    if (out.view.kind !== "table") return;

    const modified = out.view.rows[0];
    expect(modified.cells.staged).toBe("");
    expect(modified.cells.tree).toBe("modified");

    const staged = out.view.rows[1];
    expect(staged.cells.staged).toBe("modified");
    expect(staged.cells.tree).toBe("");

    const both = out.view.rows[4];
    expect(both.cells.staged).toBe("modified");
    expect(both.cells.tree).toBe("modified");
  });

  it("says the letters in words", () => {
    const out = recogniseGitStatus(done("git status -s", "?? new.txt\nD  gone.txt"))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[0].cells.tree).toBe("untracked");
    expect(out.view.rows[1].cells.staged).toBe("deleted");
  });

  /*
   * The default output is prose, and translated prose at that.
   *
   * A parser for "Changes not staged for commit:" works in English and
   * silently produces nothing in any other locale — which is worse than
   * declining, because it looks like the feature is broken rather than
   * inapplicable.
   */
  it("declines the long format rather than half-reading it", () => {
    const long = `On branch main
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   src/main.rs`;
    expect(recogniseGitStatus(done("git status", long))).toBeNull();
  });

  it("says nothing when the tree is clean", () => {
    expect(recogniseGitStatus(done("git status -s", ""))).toBeNull();
  });

  it("says nothing when the output went through something else", () => {
    expect(recogniseGitStatus(done("git status -s | wc -l", SHORT))).toBeNull();
  });
});

describe("recogniseGitLog", () => {
  const FULL = `commit b51bee9b6460c96f2aeaadba5a754e93d9809e74
Author: Ada Lovelace <ada@example.com>
Date:   Thu Sep 3 02:06:50 2026 +0530

    docs: two diagrams and fewer lines

    The README had grown into an essay.

commit c1a1dccaaaaabbbbbccccddddeeeeffff00001111
Author: Ada Lovelace <ada@example.com>
Date:   Thu Sep 3 01:40:00 2026 +0530

    feat: remove the port scanner`;

  it("reads the default format into a timeline", () => {
    const out = recogniseGitLog(done("git log", FULL))!;
    expect(out.view.kind).toBe("timeline");
    if (out.view.kind !== "timeline") return;

    expect(out.view.entries).toHaveLength(2);
    expect(out.view.entries[0].title).toBe("docs: two diagrams and fewer lines");
    expect(out.view.entries[0].meta[0]).toBe("b51bee9");
    expect(out.view.entries[0].meta).toContain("Ada Lovelace");
  });

  // The subject is the line people read; the rest is there when they want it.
  it("keeps the body apart from the subject", () => {
    const out = recogniseGitLog(done("git log", FULL))!;
    if (out.view.kind !== "timeline") return;
    expect(out.view.entries[0].body).toContain("grown into an essay");
    expect(out.view.entries[0].title).not.toContain("essay");
  });

  it("reads --oneline too", () => {
    const out = recogniseGitLog(
      done("git log --oneline", "b51bee9 docs: diagrams\nc1a1dcc feat: remove ports"),
    )!;
    if (out.view.kind !== "timeline") return;
    expect(out.view.entries).toHaveLength(2);
    expect(out.view.entries[1].title).toBe("feat: remove ports");
  });

  /*
   * `--graph` draws the branching with characters, which is the only thing
   * the flag was asked for. Flattening it into a list throws that away.
   */
  it("leaves a graph alone", () => {
    expect(recogniseGitLog(done("git log --graph --oneline", "* b51bee9 x"))).toBeNull();
  });

  it("leaves a custom format alone", () => {
    expect(recogniseGitLog(done("git log --pretty=%h", "b51bee9"))).toBeNull();
  });

  it("says nothing for output it cannot read", () => {
    expect(recogniseGitLog(done("git log", "fatal: your current branch has no commits"))).toBeNull();
  });
});
