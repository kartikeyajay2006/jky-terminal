import { create } from "zustand";
import type { GameId } from "./scores";

/**
 * A game asked for from the shell, waiting to be opened.
 *
 * The same shape as the assistant's `askStore`, and for the same reason: the
 * terminal that decodes the escape sequence is nowhere near the section that
 * has to react to it, and a store is how the two talk without either knowing
 * the other exists.
 */
interface OpenGameState {
  pending: GameId | null;
  open: (game: GameId) => void;
  /** Take the request, clearing it so one command opens one game once. */
  take: () => GameId | null;
}

export const useOpenGame = create<OpenGameState>((set, get) => ({
  pending: null,
  open: (game) => set({ pending: game }),
  take: () => {
    const { pending } = get();
    if (pending !== null) set({ pending: null });
    return pending;
  },
}));

/** Marker the `jky games <n>` shell command emits inside an OSC 1337 sequence. */
export const GAME_PREFIX = "JKYGame=";

/**
 * The four games in the order the shell numbers them.
 *
 * This ordering is the command's contract — `jky games 2` has to keep meaning
 * Snake — so it lives here beside the decoder rather than being derived from
 * a list that exists to drive a nav and could be reordered for looks.
 */
export const SHELL_ORDER: GameId[] = ["dino", "snake", "tictactoe", "flappy"];

/**
 * Decode an OSC 1337 payload into a game to open, or null if it is not one
 * of ours.
 *
 * Unlike the assistant's question this is not base64: the payload is a single
 * digit from a fixed set, so there is nothing to escape and a plain number is
 * easier to read in a trace. Anything outside that set is ignored rather than
 * guessed at — OSC 1337 is shared, application-defined space and other
 * programs put their own things in it.
 */
export function decodeGamePayload(payload: string): GameId | null {
  if (!payload.startsWith(GAME_PREFIX)) return null;

  const n = Number(payload.slice(GAME_PREFIX.length).trim());
  if (!Number.isInteger(n) || n < 1 || n > SHELL_ORDER.length) return null;
  return SHELL_ORDER[n - 1];
}
