/**
 * The app registry.
 *
 * One record per app, read by the grid, the switcher and the command palette
 * alike. They agree because they share this list rather than each keeping
 * their own — the failure mode otherwise is an app that opens from one place
 * and not another, which is the kind of bug nobody reports because it looks
 * like they misremembered where it was.
 *
 * The list grows one app per commit. An app appears here when it works, not
 * when it is planned: a tile that says "coming soon" is a tile that wastes a
 * click, and the grid is small enough that absence is not confusing.
 */

/** How an app puts pixels on screen. */
export type RenderMode =
  /** React only, no network at all. Works offline. */
  | "local"
  /** A React panel; Rust makes every request and returns data over IPC. */
  | "data"
  /** An iframe pointed at a provider's own embed endpoint. */
  | "frame";

/** Whose account an app needs, if any. */
export type AuthKind = "none" | "google" | "github" | "reddit";

/**
 * An app's colour, named as a theme token rather than given as a value.
 *
 * Every one of these is defined by all seven themes, so an app looks
 * deliberate in Light and High Contrast without a second palette to maintain.
 * A literal hex here would be right in one theme and wrong in six.
 *
 * `danger` is deliberately absent: it is what the app wears when something has
 * gone wrong, and a panel permanently dressed in it would make a real error
 * invisible.
 */
export type AppAccent =
  | "accent"
  /// Not a shade of `accent` but a colour in its own right: the dashboard uses
  /// it as a distinct event colour and the contrast test verifies it in every
  /// theme.
  | "accent-dim"
  | "violet"
  | "magenta"
  | "mint"
  | "warn"
  /// The eighth. Added with the eighth app: the palette had exactly seven
  /// colours and seven apps, and a shared accent would have made colour stop
  /// identifying anything.
  | "lime"
  /// The neutral of the set. A browser shows other people's colours, so it
  /// brings none of its own to fight with them.
  | "text-muted";

/**
 * Which half of the grid an app belongs to.
 *
 * `tool` is the developer tools: local by construction, needing no account
 * and no network, and a test enforces that. The distinction earns its keep by
 * being what the default grouping and the accent rule are both written
 * against.
 */
export type AppSection = "app" | "tool";

export interface AppDef {
  /** Stable slug. Reaches the palette, the switcher and iframe URLs. */
  id: string;
  name: string;
  /** A text glyph rather than an icon asset: themes for free, no download. */
  glyph: string;
  mode: RenderMode;
  auth: AuthKind;
  section: AppSection;
  /**
   * The app's own colour. Colour is wayfinding here, not decoration: the same
   * hue marks the tile, the switcher row and the open panel, so you can learn
   * where you are without reading.
   */
  accent: AppAccent;
  /** One line, shown on the grid tile. */
  blurb: string;
}

export const APPS: AppDef[] = [
  {
    id: "calculator",
    name: "Calculator",
    glyph: "🖩",
    mode: "local",
    auth: "none",
    section: "app",
    accent: "violet",
    blurb: "Arithmetic, with the keyboard and the history kept.",
  },
  {
    id: "timer",
    name: "Timer",
    glyph: "⏱",
    mode: "local",
    auth: "none",
    section: "app",
    accent: "warn",
    blurb: "A countdown that keeps time by the clock, not by the frame.",
  },
  {
    id: "weather",
    name: "Weather",
    glyph: "☀",
    mode: "data",
    auth: "none",
    section: "app",
    accent: "accent",
    blurb: "Now and the days ahead, anywhere. No account needed.",
  },
  {
    id: "news",
    name: "News",
    glyph: "📰",
    mode: "data",
    auth: "none",
    section: "app",
    accent: "magenta",
    blurb: "Front pages from real papers — The Hindu, TOI, BBC and more.",
  },
  {
    id: "map",
    name: "Map",
    glyph: "🗺",
    mode: "frame",
    auth: "none",
    section: "app",
    accent: "mint",
    blurb: "Look anywhere up, drawn by OpenStreetMap inside this window.",
  },
  {
    id: "github",
    name: "GitHub",
    glyph: "◐",
    mode: "data",
    auth: "github",
    section: "app",
    accent: "accent-dim",
    blurb: "Your repositories, issues and pull requests. Approved on your phone.",
  },
  {
    id: "gmail",
    name: "Gmail",
    glyph: "✉",
    mode: "data",
    auth: "google",
    section: "app",
    accent: "lime",
    blurb: "Read your inbox here. Read-only — nothing can be sent or deleted.",
  },
  {
    id: "browser",
    name: "Browser",
    glyph: "🌐",
    mode: "frame",
    auth: "none",
    section: "app",
    accent: "text-muted",
    blurb: "Private browsing in this window. Nothing is kept when you leave.",
  },
];

/*
 * The developer tools.
 *
 * Six, and every one a function of what you paste into it: no account, no
 * network, nothing kept. That is why these six and not the other eighteen
 * anyone might want — a tile needing a Kubernetes config or a database
 * password is a different kind of promise, and this section does not make it.
 *
 * They reuse the accents the apps above use, which the registry test permits
 * within a section. Colour tells a tile from the ones beside it, and these
 * are never beside those.
 */
const TOOLS: AppDef[] = [
  {
    id: "json",
    name: "JSON Tool",
    glyph: "{}",
    mode: "local",
    auth: "none",
    section: "tool",
    accent: "accent",
    blurb: "Format, check and explore JSON. Says where it broke, not only that it did.",
  },
  {
    id: "yaml",
    name: "YAML Tool",
    glyph: "\u2261",
    mode: "data",
    auth: "none",
    section: "tool",
    accent: "warn",
    blurb: "Tidy YAML, and convert it to JSON and back.",
  },
  {
    id: "diff",
    name: "Diff Viewer",
    glyph: "\u00b1",
    mode: "data",
    auth: "none",
    section: "tool",
    accent: "mint",
    blurb: "Compare two pieces of text line by line, with both sets of line numbers.",
  },
  {
    id: "hash",
    name: "Hash Generator",
    glyph: "#",
    mode: "data",
    auth: "none",
    section: "tool",
    accent: "violet",
    blurb: "MD5, SHA-1, SHA-256 and SHA-512, all at once.",
  },
  {
    id: "jwt",
    name: "JWT Decoder",
    glyph: "\u2299",
    mode: "local",
    auth: "none",
    section: "tool",
    accent: "magenta",
    blurb: "Read what is inside a token. Decodes only \u2014 it never claims one is valid.",
  },
  {
    id: "regex",
    name: "Regex Tester",
    glyph: "*",
    mode: "local",
    auth: "none",
    section: "tool",
    accent: "lime",
    blurb: "Try a pattern against text. Runs off the main thread, so it cannot hang.",
  },
];

APPS.push(...TOOLS);

export function findApp(id: string): AppDef | undefined {
  return APPS.find((app) => app.id === id);
}
