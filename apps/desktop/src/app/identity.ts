/**
 * The name and note behind the mark at the top of the rail.
 *
 * Kept here rather than in `jky-store` for the same reason the theme is: it is
 * how this copy of the app is set up, not content the user would expect to
 * find listed somewhere. It is also the sort of thing that should survive a
 * reinstall being lost without anyone minding.
 */

const KEY = "jky.identity";

export interface Identity {
  /** Shown in full on hover and under the mark. Empty means "unset". */
  name: string;
  /** A line under the name. A greeting, a machine, a reminder — anything. */
  message: string;
}

export const DEFAULT_IDENTITY: Identity = { name: "", message: "" };

/** What the mark shows when there is no name: the app's own initial. */
export const FALLBACK_INITIALS = "J";

/** How much text the fields will take. Long enough to be useful, short
 *  enough that the rail is not reshaped by it. */
export const MAX_NAME = 24;
export const MAX_MESSAGE = 60;

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_IDENTITY };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_IDENTITY };
    const v = parsed as Record<string, unknown>;
    return {
      name: typeof v.name === "string" ? v.name.slice(0, MAX_NAME) : "",
      message: typeof v.message === "string" ? v.message.slice(0, MAX_MESSAGE) : "",
    };
  } catch {
    // Storage can throw outright in a private window; the mark still draws.
    return { ...DEFAULT_IDENTITY };
  }
}

export function saveIdentity(identity: Identity): Identity {
  const clean: Identity = {
    name: identity.name.trim().slice(0, MAX_NAME),
    message: identity.message.trim().slice(0, MAX_MESSAGE),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Preference lost, app fine.
  }
  return clean;
}

/**
 * What to draw in the mark.
 *
 * Up to two initials from a name — "Kartikeya Yadav" becomes "KY" — because
 * the mark is a small square and two letters is what fits legibly. A
 * single-word name gives one letter rather than two from the same word, which
 * would read as a stutter.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return FALLBACK_INITIALS;

  const letters = words
    .slice(0, 2)
    .map((w) => [...w][0] ?? "")
    .join("");

  return letters.toUpperCase() || FALLBACK_INITIALS;
}
