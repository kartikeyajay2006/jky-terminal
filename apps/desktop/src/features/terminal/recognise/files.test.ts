import { describe, expect, it } from "vitest";
import { recogniseFileAction, recogniseLs } from "./files";
import type { Completion } from "./types";

const done = (command: string, output = "", code = 0, cwd = "/home/me/work"): Completion => ({
  command,
  output,
  code,
  cwd,
});

describe("recogniseFileAction", () => {
  /*
   * The command everyone runs and nothing confirms.
   *
   * `mkdir project` prints nothing, which is the shell being correct and
   * unhelpful at once. The card is built from the command and the exit
   * status, because there is no output to read.
   */
  it("says what mkdir made, and where", () => {
    const out = recogniseFileAction(done("mkdir project_name"));
    expect(out).not.toBeNull();
    expect(out!.title).toBe("Created project_name");
    expect(out!.view).toMatchObject({ kind: "facts" });
    if (out!.view.kind === "facts") {
      expect(out!.view.facts.some((f) => f.value === "/home/me/work")).toBe(true);
    }
  });

  it("ignores the flags when naming what was made", () => {
    expect(recogniseFileAction(done("mkdir -p a/b/c"))!.title).toBe("Created a/b/c");
  });

  it("counts them when there are several", () => {
    expect(recogniseFileAction(done("mkdir one two three"))!.title).toBe(
      "Created 3 directories",
    );
  });

  /*
   * `cp a b` ends at a destination, and calling that a source would be
   * exactly backwards about what happened.
   */
  it("tells a source from a destination", () => {
    const out = recogniseFileAction(done("cp notes.md backup/notes.md"))!;
    expect(out.title).toBe("Copied notes.md");
    expect(out.subtitle).toContain("backup/notes.md");
    if (out.view.kind === "facts") {
      expect(out.view.facts).toContainEqual({ label: "From", value: "notes.md" });
      expect(out.view.facts).toContainEqual({ label: "To", value: "backup/notes.md" });
    }
  });

  // After a removal the path is gone, so the place to look is what held it.
  it("offers to look at the parent after a removal", () => {
    const out = recogniseFileAction(done("rm -rf build/output"))!;
    expect(out.actions![0].command).toBe("ls -la build");
  });

  /*
   * A command that failed has already printed why. A card repeating "did not
   * create it" adds a second thing to read and no information.
   */
  it("says nothing when the command failed", () => {
    expect(recogniseFileAction(done("mkdir /root/nope", "", 1))).toBeNull();
  });

  it("says nothing about a command it does not know", () => {
    expect(recogniseFileAction(done("cargo build"))).toBeNull();
    expect(recogniseFileAction(done("mkdir"))).toBeNull();
  });

  /*
   * A pipe means the output came from somewhere else, and so might the
   * behaviour. Refused rather than half-understood.
   */
  it("says nothing when the command was part of something larger", () => {
    expect(recogniseFileAction(done("mkdir a && cd a"))).toBeNull();
    expect(recogniseFileAction(done("echo x > mkdir"))).toBeNull();
  });

  it("understands sudo in front of it", () => {
    expect(recogniseFileAction(done("sudo mkdir /opt/thing"))!.title).toBe(
      "Created /opt/thing",
    );
  });
});

describe("recogniseLs", () => {
  const LONG = `total 0
drwxr-xr-x. 1 me me 26 Aug 27 00:48 jky-ai
drwxr-xr-x. 1 me me 52 Sep  2 01:23 jky-apps
-rw-r--r--. 1 me me 4096 Sep  1 10:00 notes.md
lrwxrwxrwx. 1 me me 7 Sep  1 10:00 link -> notes.md`;

  it("reads a long listing into a table", () => {
    const out = recogniseLs(done("ls -l crates", LONG))!;
    expect(out.view.kind).toBe("table");
    if (out.view.kind !== "table") return;

    expect(out.view.rows).toHaveLength(4);
    expect(out.view.rows[0].cells.name).toBe("jky-ai");
    expect(out.view.rows[0].cells.kind).toBe("dir");
    expect(out.view.rows[2].cells.name).toBe("notes.md");
    expect(out.view.rows[2].cells.size).toBe("4.0 KB");
  });

  // `total 0` is a summary of the listing, not a thing in it.
  it("does not count the total line as an entry", () => {
    const out = recogniseLs(done("ls -l", LONG))!;
    if (out.view.kind === "table") {
      expect(out.view.rows.some((r) => r.cells.name.startsWith("total"))).toBe(false);
    }
  });

  it("tells directories, files and links apart", () => {
    const out = recogniseLs(done("ls -l", LONG))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows.map((r) => r.cells.kind)).toEqual(["dir", "dir", "file", "link"]);
  });

  /*
   * Plain `ls` prints names in columns sized for a terminal, and says nothing
   * else about them — so it is read back as names and nothing more.
   */
  it("reads a plain listing as names", () => {
    const out = recogniseLs(done("ls", "one.txt   two.txt   three.txt\nfour.txt"))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows.map((r) => r.cells.name)).toEqual([
      "one.txt",
      "two.txt",
      "three.txt",
      "four.txt",
    ]);
  });

  /*
   * A listing where nothing parsed is not a listing.
   *
   * Showing an empty table beside a wall of text would be worse than showing
   * nothing, which is always available and always correct.
   */
  it("says nothing when the long output does not parse", () => {
    expect(recogniseLs(done("ls -l", "this is not a listing at all"))).toBeNull();
  });

  it("says nothing for an empty directory", () => {
    expect(recogniseLs(done("ls", ""))).toBeNull();
  });

  it("says nothing when the command failed", () => {
    expect(recogniseLs(done("ls /nope", "No such file or directory", 2))).toBeNull();
  });

  it("says nothing when the output went through something else", () => {
    expect(recogniseLs(done("ls -l | grep foo", LONG))).toBeNull();
  });

  it("names the directory it listed, or where it ran", () => {
    expect(recogniseLs(done("ls -l crates", LONG))!.title).toBe("crates");
    expect(recogniseLs(done("ls -l", LONG))!.title).toBe("/home/me/work");
  });
});
