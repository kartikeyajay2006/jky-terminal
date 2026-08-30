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

export interface AppDef {
  /** Stable slug. Reaches the palette, the switcher and iframe URLs. */
  id: string;
  name: string;
  /** A text glyph rather than an icon asset: themes for free, no download. */
  glyph: string;
  mode: RenderMode;
  auth: AuthKind;
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
    blurb: "Arithmetic, with the keyboard and the history kept.",
  },
  {
    id: "timer",
    name: "Timer",
    glyph: "⏱",
    mode: "local",
    auth: "none",
    blurb: "A countdown that keeps time by the clock, not by the frame.",
  },
  {
    id: "weather",
    name: "Weather",
    glyph: "☀",
    mode: "data",
    auth: "none",
    blurb: "Now and the days ahead, anywhere. No account needed.",
  },
  {
    id: "news",
    name: "News",
    glyph: "📰",
    mode: "data",
    auth: "none",
    blurb: "The Hacker News front page, with the site each link goes to.",
  },
  {
    id: "map",
    name: "Map",
    glyph: "🗺",
    mode: "frame",
    auth: "none",
    blurb: "Look anywhere up, drawn by OpenStreetMap inside this window.",
  },
];

export function findApp(id: string): AppDef | undefined {
  return APPS.find((app) => app.id === id);
}
