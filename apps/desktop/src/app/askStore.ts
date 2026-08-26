import { create } from "zustand";

interface AskState {
  /** A question raised from a terminal, waiting for the assistant to take it. */
  pending: string | null;
  ask: (question: string) => void;
  /** Take the question, clearing it so it is asked exactly once. */
  take: () => string | null;
}

export const useAsk = create<AskState>((set, get) => ({
  pending: null,
  ask: (question) => {
    const trimmed = question.trim();
    if (trimmed) set({ pending: trimmed });
  },
  take: () => {
    const { pending } = get();
    if (pending !== null) set({ pending: null });
    return pending;
  },
}));

/** Marker the `jky ask` shell command emits inside an OSC 1337 sequence. */
export const ASK_PREFIX = "JKYAsk=";

/**
 * Decode an OSC 1337 payload into a question, or null if it is not one of ours.
 *
 * The payload is base64 so a question containing quotes, newlines, or the
 * sequence terminator cannot break out of it. Anything that fails to decode is
 * ignored rather than shown: OSC 1337 is a shared, application-defined space
 * and other programs use it for their own purposes.
 */
export function decodeAskPayload(payload: string): string | null {
  if (!payload.startsWith(ASK_PREFIX)) return null;

  const encoded = payload.slice(ASK_PREFIX.length).trim();
  if (!encoded) return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).trim();
    return text || null;
  } catch {
    return null;
  }
}
