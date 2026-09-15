import { describe, expect, it } from "vitest";
import { terminalColours } from "./termColours";

/*
 * The Cyberpunk palette, spelled out so every value is distinct and a colour
 * can be traced back to the one token it came from.
 */
const TOKENS: Record<string, string> = {
  "--ground": "#08080c",
  "--text": "#e8e8f2",
  "--text-muted": "#9a9ab2",
  "--text-dim": "#6e6e85",
  "--accent": "#00e5ff",
  "--accent-dim": "#00a3b5",
  "--accent-glow": "rgba(0, 229, 255, 0.14)",
  "--violet": "#7c3aed",
  "--magenta": "#ff3cf0",
  "--danger": "#ff4d6a",
  "--mint": "#3ddc97",
  "--warn": "#ffb340",
  "--lime": "#a3e635",
  "--line-strong": "#2a2a3c",
};

// getComputedStyle hands custom properties back with their leading space.
const read = (name: string) => ` ${TOKENS[name] ?? ""}`;

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/*
 * The tokens `styles/contrast.test.ts` measures against every theme's ground.
 * A terminal colour drawn from one of these is readable in every theme,
 * because that test fails otherwise.
 */
const MEASURED = new Set([
  "--text",
  "--text-muted",
  "--text-dim",
  "--accent",
  "--accent-dim",
  "--magenta",
  "--danger",
  "--warn",
  "--violet",
  "--mint",
  "--lime",
]);

const tokenOf = (value: string | undefined) =>
  Object.entries(TOKENS).find(([, v]) => v === value)?.[0];

describe("terminal colours", () => {
  it("paints the terminal in the theme's own ground and text", () => {
    const theme = terminalColours(read);
    expect(theme.background).toBe("#08080c");
    expect(theme.foreground).toBe("#e8e8f2");
    expect(theme.cursor).toBe("#00e5ff");
    // The character under a block cursor, which sits on the accent.
    expect(theme.cursorAccent).toBe("#08080c");
  });

  it("draws every ANSI colour from a token the contrast test already measures", () => {
    const theme = terminalColours(read);
    for (const key of ANSI) {
      const token = tokenOf(theme[key]);
      expect(token, `${key} is ${String(theme[key])}, which is no token`).toBeDefined();
      expect(MEASURED.has(token!), `${key} comes from ${token}, which nothing measures`).toBe(true);
    }
  });

  it("keeps a selected cell in its own colour, over a tint rather than a fill", () => {
    const theme = terminalColours(read);
    expect(theme.selectionBackground).toBe("rgba(0, 229, 255, 0.14)");
    // Forcing one colour onto every selected cell would put text in a pairing
    // nothing has measured.
    expect(theme.selectionForeground).toBeUndefined();
  });

  it("leaves a colour to xterm rather than inventing one when its token cannot be read", () => {
    const partial = (name: string) => (name === "--danger" ? "" : read(name));
    const theme = terminalColours(partial);
    expect(theme.red).toBeUndefined();
    expect(theme.brightRed).toBeUndefined();
    expect(theme.green).toBe("#3ddc97");
  });
});
