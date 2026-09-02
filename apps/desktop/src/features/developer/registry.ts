import type { EventColour } from "../../platform";

/**
 * The developer tools.
 *
 * A section of their own rather than a corner of Apps. An app is a place you
 * go and stay — a mailbox, a browser, a game — and it earns a tab. A tool is
 * something you reach for, use, and leave, usually while doing something
 * else. Put them in the same grid and every one of them has to pretend to be
 * the other kind.
 *
 * The shape follows the Dashboard and Settings: a list down the side and the
 * chosen thing beside it. Switching is instant and there is nothing to
 * manage, which is right for six things you dip into.
 *
 * Every tool here is a function of what you paste into it: no account, no
 * key, no network, nothing kept. A test enforces it, and it is why these six
 * and not the twenty others anyone might want — a Kubernetes or database
 * tile needs a config file or a password, which is a different promise.
 */
export interface ToolDef {
  /** Stable slug. Reaches the palette and the stored selection. */
  id: string;
  name: string;
  /** A text glyph rather than an icon asset: themes for free, no download. */
  glyph: string;
  /** One line, shown beside the name in the list. */
  blurb: string;
  /**
   * The tool's colour, named as a theme token.
   *
   * The same six the dashboard cards use, and for the same reason: you find
   * the one you want by colour before reading a word.
   */
  tone: EventColour;
  /** Whether the work happens in Rust. Shown, because it explains the wait. */
  backend: "window" | "rust";
}

export const TOOLS: ToolDef[] = [
  {
    id: "json",
    name: "JSON",
    glyph: "{}",
    blurb: "Format and check. Says which line and column stopped it.",
    tone: "cyan",
    backend: "window",
  },
  {
    id: "yaml",
    name: "YAML",
    glyph: "≡",
    blurb: "Tidy it, and convert to JSON and back.",
    tone: "amber",
    backend: "rust",
  },
  {
    id: "diff",
    name: "Diff",
    glyph: "±",
    blurb: "Compare two texts, line by line, with both line numbers.",
    tone: "mint",
    backend: "rust",
  },
  {
    id: "hash",
    name: "Hash",
    glyph: "#",
    blurb: "MD5, SHA-1, SHA-256 and SHA-512, all at once.",
    tone: "violet",
    backend: "rust",
  },
  {
    id: "jwt",
    name: "JWT",
    glyph: "⊙",
    blurb: "Read what is inside a token. Never claims one is valid.",
    tone: "rose",
    backend: "window",
  },
  {
    id: "regex",
    name: "Regex",
    glyph: "*",
    blurb: "Try a pattern against text, off the main thread.",
    tone: "azure",
    backend: "window",
  },
];

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
