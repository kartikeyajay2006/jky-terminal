import { describe, expect, it } from "vitest";
import { buildBanner, hexToAnsi, parseHex } from "./banner";

const ESC = "\u001b";
// Stripping ANSI is exactly a control-character match, so the rule is
// disabled here rather than switched off for the project.
// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("parseHex", () => {
  it("reads a six-digit hex colour", () => {
    expect(parseHex("#00e5ff")).toEqual([0, 229, 255]);
  });

  it("reads a three-digit shorthand", () => {
    expect(parseHex("#0f8")).toEqual([0, 255, 136]);
  });

  it("tolerates surrounding whitespace, as getComputedStyle returns it", () => {
    expect(parseHex("  #7c3aed ")).toEqual([124, 58, 237]);
  });

  it("returns null for anything it cannot read", () => {
    expect(parseHex("rgba(0,0,0,0.5)")).toBeNull();
    expect(parseHex("")).toBeNull();
    expect(parseHex("not-a-colour")).toBeNull();
  });
});

describe("hexToAnsi", () => {
  it("emits a truecolor foreground escape", () => {
    expect(hexToAnsi([0, 229, 255])).toBe(`${ESC}[38;2;0;229;255m`);
  });
});

describe("buildBanner", () => {
  const palette = { accent: "#00e5ff", violet: "#7c3aed", magenta: "#ff3cf0" };

  it("draws the JKY wordmark", () => {
    const text = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    // The wordmark is drawn in block characters, so assert on the blocks
    // rather than the letters — there are no letters to find.
    expect(text).toContain("█");
    expect(text.split("\r\n").length).toBeGreaterThan(5);
  });

  it("states the product name and version", () => {
    const text = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    expect(text).toContain("JKY Terminal");
    expect(text).toContain("0.1.0");
  });

  it("tells the user how to open another terminal", () => {
    const text = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    expect(text.toLowerCase()).toContain("new terminal");
  });

  it("colours the wordmark when the palette is readable", () => {
    const out = buildBanner({ cols: 100, version: "0.1.0", palette });
    expect(out).toContain(`${ESC}[38;2;0;229;255m`);
  });

  it("resets the colour at the end", () => {
    // Without a reset the shell prompt inherits the banner's colour, which
    // looks like a broken terminal rather than a styled one.
    const out = buildBanner({ cols: 100, version: "0.1.0", palette });
    expect(out.endsWith(`${ESC}[0m\r\n`)).toBe(true);
  });

  it("emits no colour escapes when the palette cannot be read", () => {
    // Tokens are unreadable in some contexts. Plain text is a fine outcome;
    // hard-coded fallback colours would violate the one-source-of-colour rule.
    const out = buildBanner({
      cols: 100,
      version: "0.1.0",
      palette: { accent: "", violet: "", magenta: "" },
    });
    expect(out).not.toContain(`${ESC}[38;2;`);
    expect(strip(out)).toContain("JKY Terminal");
  });

  it("falls back to a compact form in a narrow pane", () => {
    const wide = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    const narrow = strip(buildBanner({ cols: 30, version: "0.1.0", palette }));
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow).toContain("JKY Terminal");
  });

  it("never emits a line wider than the pane", () => {
    for (const cols of [24, 40, 80, 120]) {
      const lines = strip(buildBanner({ cols, version: "0.1.0", palette })).split("\r\n");
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(cols);
      }
    }
  });

  it("uses CRLF, because a pty expects carriage returns", () => {
    const out = buildBanner({ cols: 100, version: "0.1.0", palette });
    expect(out).toContain("\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });
});
