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

export interface AppDef {
  /** Stable slug. Reaches the palette, the switcher and iframe URLs. */
  id: string;
  name: string;
  /** A text glyph rather than an icon asset: themes for free, no download. */
  glyph: string;
  mode: RenderMode;
  auth: AuthKind;
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
    accent: "violet",
    blurb: "Arithmetic, with the keyboard and the history kept.",
  },
  {
    id: "timer",
    name: "Timer",
    glyph: "⏱",
    mode: "local",
    auth: "none",
    accent: "warn",
    blurb: "A countdown that keeps time by the clock, not by the frame.",
  },
  {
    id: "weather",
    name: "Weather",
    glyph: "☀",
    mode: "data",
    auth: "none",
    accent: "accent",
    blurb: "Now and the days ahead, anywhere. No account needed.",
  },
  {
    id: "news",
    name: "News",
    glyph: "📰",
    mode: "data",
    auth: "none",
    accent: "magenta",
    blurb: "Front pages from real papers — The Hindu, TOI, BBC and more.",
  },
  {
    id: "map",
    name: "Map",
    glyph: "🗺",
    mode: "frame",
    auth: "none",
    accent: "mint",
    blurb: "Look anywhere up, drawn by OpenStreetMap inside this window.",
  },
  {
    id: "github",
    name: "GitHub",
    glyph: "◐",
    mode: "data",
    auth: "github",
    accent: "accent-dim",
    blurb: "Your repositories, issues and pull requests. Approved on your phone.",
  },
  {
    id: "gmail",
    name: "Gmail",
    glyph: "✉",
    mode: "data",
    auth: "google",
    accent: "lime",
    blurb: "Read your inbox here. Read-only — nothing can be sent or deleted.",
  },
  {
    id: "browser",
    name: "Browser",
    glyph: "🌐",
    mode: "frame",
    auth: "none",
    accent: "text-muted",
    blurb: "Private browsing in this window. Nothing is kept when you leave.",
  },
];

export function findApp(id: string): AppDef | undefined {
  return APPS.find((app) => app.id === id);
}
