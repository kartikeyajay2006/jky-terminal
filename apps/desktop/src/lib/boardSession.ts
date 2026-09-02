/**
 * Which things on a board are open, and which is showing.
 *
 * Shared by the Apps grid and the Developer Tools grid. Both want the same
 * behaviour — several open at once, kept mounted, closing one moves to a
 * neighbour — and both would otherwise grow their own copy of it, where the
 * second copy is the one that stops getting fixed.
 *
 * Pure, so the awkward cases are testable without a screen: closing the thing
 * you are looking at, closing one you are not, closing the last of them, and
 * opening something already open.
 */

export interface Session {
  open: string[];
  /** Null means the board is showing; what is open stays open behind it. */
  active: string | null;
}

export const EMPTY: Session = { open: [], active: null };

/** Open something, or bring it forward when it already is. */
export function openIn(session: Session, id: string): Session {
  return {
    open: session.open.includes(id) ? session.open : [...session.open, id],
    active: id,
  };
}

/** Show the board again, leaving everything open behind it. */
export function showBoard(session: Session): Session {
  return { ...session, active: null };
}

/**
 * Close one.
 *
 * Closing the one you are looking at moves to a neighbour rather than to the
 * board — you were working in a tab, and being thrown back to the grid every
 * time you finished with one is a step you did not ask for. Closing the last
 * one has nowhere to go, so the board comes back.
 */
export function closeIn(session: Session, id: string): Session {
  const at = session.open.indexOf(id);
  if (at === -1) return session;

  const open = session.open.filter((other) => other !== id);
  if (session.active !== id) return { ...session, open };

  // The one that took its place, or the one before it at the end.
  const next = open[at] ?? open[at - 1] ?? null;
  return { open, active: next };
}

/**
 * Read a stored session, keeping only what still exists.
 *
 * `exists` is asked about every id, so something removed in a later version
 * does not leave a tab that opens nothing.
 */
export function loadSession(key: string, exists: (id: string) => boolean): Session {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const stored = parsed as Partial<Session>;
        const open = (Array.isArray(stored.open) ? stored.open : []).filter(
          (id): id is string => typeof id === "string" && exists(id),
        );
        const active = stored.active;
        return {
          open,
          active: typeof active === "string" && open.includes(active) ? active : null,
        };
      }
    }
  } catch {
    // Storage throws in a private window; an empty session is a fine default.
  }
  return EMPTY;
}

export function saveSession(key: string, session: Session): void {
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Nothing to be done, and nothing worth interrupting anyone over.
  }
}
