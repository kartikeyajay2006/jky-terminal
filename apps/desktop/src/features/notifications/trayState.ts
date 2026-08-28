/**
 * What the notification tray remembers between launches.
 *
 * Two things, both per-viewer preference rather than app data: whether the
 * tray is open, and which due instances have been dismissed. Neither goes
 * through the platform store — dismissing a notification is not deleting the
 * event or reminder it is about, so it has no business anywhere near
 * `jky-store`, which promises nothing gets removed until the user removes it.
 */

const OPEN_KEY = "jky.notifications.open";
const DISMISSED_KEY = "jky.notifications.dismissed";

export function loadTrayOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    // Storage can throw outright in a private window. A remembered
    // preference is a convenience; never let it take the app down.
    return false;
  }
}

export function saveTrayOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    // Same reasoning as loadTrayOpen: preference lost, app fine.
  }
}

export function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveDismissed(keys: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Preference lost, app fine.
  }
}

/**
 * Drop dismissal keys for anything that is not among the keys currently due.
 *
 * Without this the set grows for the life of the install: every event and
 * every day's reminder leaves a key behind forever. Called with whatever is
 * due *right now*, so a key is only ever pruned once its due window has
 * genuinely closed, never while it might still be shown again.
 */
export function pruneDismissed(dismissed: Set<string>, currentlyDueKeys: Set<string>): Set<string> {
  const kept = [...dismissed].filter((k) => currentlyDueKeys.has(k));
  return new Set(kept);
}
