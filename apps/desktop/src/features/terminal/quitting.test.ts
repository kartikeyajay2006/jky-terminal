import { describe, expect, it } from "vitest";
import { quitBody, quitTitle } from "./quitting";

describe("what the quit question says", () => {
  it("names unsaved files when that is what there is", () => {
    expect(quitTitle(1, 0)).toBe("1 unsaved file");
    expect(quitTitle(3, 0)).toBe("3 unsaved files");
  });

  it("names running commands when that is what there is", () => {
    // A four-minute build is work in progress exactly as much as an unsaved
    // file, and asking about files would be asking about the wrong thing.
    expect(quitTitle(0, 1)).toBe("1 command still running");
    expect(quitTitle(0, 2)).toBe("2 commands still running");
  });

  it("names both when both are true", () => {
    expect(quitTitle(2, 1)).toBe("2 unsaved files and 1 command still running");
  });

  it("says what is lost, and only what applies", () => {
    expect(quitBody(1, 0)).toContain("not on disk");
    expect(quitBody(1, 0)).not.toContain("child of this window");

    expect(quitBody(0, 1)).toContain("child of this window");
    expect(quitBody(0, 1)).not.toContain("not on disk");

    const both = quitBody(1, 1);
    expect(both).toContain("not on disk");
    expect(both).toContain("child of this window");
  });
  it("does not claim that every shell dies with the window, because most do not", () => {
    // Most local shells are held by a supervisor now. The ones quitting asks
    // about are those still children of the window, and the question has to
    // say that rather than something that is no longer true of all of them.
    expect(quitBody(0, 1)).not.toMatch(/^A shell is/);
    expect(quitBody(0, 1)).toContain("child of this window");
  });
});
