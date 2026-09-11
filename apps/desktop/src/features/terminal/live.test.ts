import { describe, expect, it } from "vitest";
import { liveSourceFor, liveSpellings } from "./live";

describe("which commands can be kept live", () => {
  it("knows the ones Rust can run again", () => {
    expect(liveSourceFor("df -h")).toBe("df");
    expect(liveSourceFor("ps aux")).toBe("ps");
    expect(liveSourceFor("docker ps")).toBe("docker-ps");
  });

  it("ignores the spaces somebody typed twice", () => {
    expect(liveSourceFor("  docker   ps  ")).toBe("docker-ps");
  });

  it("refuses a command it would refresh differently from", () => {
    // The refresh runs a fixed argument list, not the words you typed. A
    // panel that answered `df -x tmpfs` with `df -h` would be answering a
    // different question from the one on screen.
    expect(liveSourceFor("df -x tmpfs")).toBeNull();
    expect(liveSourceFor("docker ps -a")).toBeNull();
    expect(liveSourceFor("ps -ef")).toBeNull();
  });

  it("refuses anything else at all", () => {
    for (const command of ["", "   ", "ls -l", "rm -rf /", "df -h | grep /", "sudo df -h"]) {
      expect(liveSourceFor(command), command).toBeNull();
    }
  });

  it("offers no spelling that is not an exact command", () => {
    // Every spelling has to be something a person actually types, or the
    // panel offers a refresh for a command nobody ran.
    for (const [id, spellings] of Object.entries(liveSpellings())) {
      expect(spellings.length, id).toBeGreaterThan(0);
      for (const spelling of spellings) {
        expect(spelling.trim(), id).toBe(spelling);
        expect(liveSourceFor(spelling)).toBe(id);
      }
    }
  });
});
