import { describe, expect, it } from "vitest";
import { loadMode, modeFor } from "./language";

describe("choosing a language", () => {
  it("knows the extensions this project is written in", () => {
    expect(modeFor("src/App.tsx")).toBe("tsx");
    expect(modeFor("src/main.ts")).toBe("typescript");
    expect(modeFor("vite.config.js")).toBe("javascript");
    expect(modeFor("crates/jky-pty/src/lib.rs")).toBe("rust");
    expect(modeFor("package.json")).toBe("json");
    expect(modeFor("README.md")).toBe("markdown");
    expect(modeFor("styles/base.css")).toBe("css");
    expect(modeFor("index.html")).toBe("html");
    expect(modeFor("scripts/build.py")).toBe("python");
  });

  it("ignores case, because a filesystem may not", () => {
    expect(modeFor("README.MD")).toBe("markdown");
    expect(modeFor("Main.RS")).toBe("rust");
  });

  it("reads the extension, not the path", () => {
    // A directory called `src.rs` must not make every file in it Rust.
    expect(modeFor("src.rs/notes.md")).toBe("markdown");
  });

  it("knows a few files whose name is the whole answer", () => {
    expect(modeFor("Dockerfile")).toBe("python");
    expect(modeFor("some/path/Makefile")).toBe("python");
  });

  it("says nothing for a file it knows nothing about", () => {
    // An ordinary answer, not a failure: the file opens as plain text, which
    // is what it is. Guessing from the contents would colour it wrong with
    // confidence.
    expect(modeFor("data.bin")).toBeNull();
    expect(modeFor("LICENSE")).toBeNull();
    expect(modeFor("noextension")).toBeNull();
  });

  it("loads nothing when there is nothing to load", async () => {
    expect(await loadMode(null)).toBeNull();
    expect(await loadMode("klingon")).toBeNull();
  });

  it("loads a mode that exists", async () => {
    // Each is a dynamic import, so it is a chunk of its own rather than
    // something in the bundle of somebody who never opens the editor.
    expect(await loadMode("json")).not.toBeNull();
    expect(await loadMode("rust")).not.toBeNull();
  });
});
