import { describe, expect, it } from "vitest";
import { buildBanner, hexToAnsi, parseHex, shade } from "./banner";

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

  it("draws the bevel dimmer than the letter face", () => {
    // The two-weight treatment is what makes the mark read as a logo rather
    // than as ASCII art, so it is worth pinning. A single readable stop
    // flattens the gradient to one colour, which makes the face and bevel
    // values exact rather than position-dependent.
    const flat = { accent: "#00e5ff", violet: "not-a-colour", magenta: "" };
    const out = buildBanner({ cols: 100, version: "0.1.0", palette: flat });

    const face = hexToAnsi([0, 229, 255]);
    const bevel = hexToAnsi(shade([0, 229, 255], 0.42));
    expect(face).not.toBe(bevel);
    expect(out).toContain(face);
    expect(out).toContain(bevel);
  });

  it("separates the mark from the hints with a rule", () => {
    const text = strip(buildBanner({ cols: 60, version: "0.1.0", palette }));
    expect(text).toContain("─");
  });

  it("right-aligns the version against the pane width", () => {
    const lines = strip(buildBanner({ cols: 70, version: "0.1.0", palette })).split("\r\n");
    const line = lines.find((l) => l.includes("v0.1.0"))!;
    expect(line).toContain("Infinite Possibilities.");
    expect(line.trimEnd().endsWith("v0.1.0")).toBe(true);
  });

  it("states the tagline and version", () => {
    const text = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    expect(text).toContain("Infinite Possibilities.");
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
    expect(strip(out)).toContain("Infinite Possibilities.");
  });

  it("falls back to a compact form in a narrow pane", () => {
    const wide = strip(buildBanner({ cols: 100, version: "0.1.0", palette }));
    // Below the wordmark's width plus its gutters, so the compact form applies.
    const narrow = strip(buildBanner({ cols: 20, version: "0.1.0", palette }));
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow).toContain("JKY Terminal");
  });

  it("describes shade as a darkening of the input", () => {
    expect(shade([100, 200, 50], 0.5)).toEqual([50, 100, 25]);
    expect(shade([10, 10, 10], 1)).toEqual([10, 10, 10]);
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

describe("the shortcut hints", () => {
  const banner = () =>
    strip(
      buildBanner({
        cols: 120,
        version: "0.1.0",
        palette: { accent: "#00e5ff", violet: "#7c3aed", magenta: "#ff3cf0" },
      }),
    );

  it("names the palette, which is how the rest of the app is reached", () => {
    expect(banner()).toContain("Ctrl+K");
  });

  it("still names the tab shortcuts", () => {
    const text = banner();
    expect(text).toContain("Ctrl+T");
    expect(text).toContain("Ctrl+W");
  });

  it("names find, now that the terminal has it", () => {
    expect(banner()).toContain("Ctrl+F");
  });

  it("does not promise a shortcut that is not bound", () => {
    // Every shortcut named here is handled: the palette and tabs in App and
    // useShortcuts, find and copy/paste in the Terminal component.
    const named = banner().match(/Ctrl\+[A-Z0-9-]+/g) ?? [];
    const bound = new Set(["Ctrl+K", "Ctrl+T", "Ctrl+W", "Ctrl+F", "Ctrl+1-9"]);
    for (const shortcut of named) {
      expect(bound, `${shortcut} is advertised but not bound`).toContain(shortcut);
    }
  });
});
