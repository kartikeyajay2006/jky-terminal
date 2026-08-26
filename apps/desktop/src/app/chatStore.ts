import { create } from "zustand";
import type { ToolRequest } from "../platform";

/**
 * How many conversations are kept.
 *
 * Beyond this the oldest is pruned. One constant, so changing the policy is a
 * one-word edit rather than a hunt.
 */
export const MAX_SESSIONS = 5;

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface Session {
  id: string;
  title: string;
  turns: Turn[];
  createdAt: number;
}

interface ChatState {
  sessions: Session[];
  activeId: string | null;
  busy: boolean;
  /** Tool calls waiting on a decision. Held here, not in the panel, so
   *  switching to the terminal mid-approval does not lose them. */
  tools: ToolRequest[];
  error: string | null;
  /** Which provider the assistant talks to. */
  provider: string;
  newSession: () => string;
  switchTo: (id: string) => void;
  deleteSession: (id: string) => void;
  addTurn: (role: Turn["role"], text: string) => void;
  appendToLastAssistant: (text: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  addTool: (request: ToolRequest) => void;
  clearTool: (id: string) => void;
  setProvider: (provider: string) => void;
}

let counter = 0;
const nextId = () => `chat-${Date.now()}-${++counter}`;

const UNTITLED = "New conversation";

/** A session named after its first question is findable; "Session 3" is not. */
function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return UNTITLED;
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeId: null,
  busy: false,
  tools: [],
  error: null,
  provider: "openai",

  newSession: () => {
    const id = nextId();
    const session: Session = { id, title: UNTITLED, turns: [], createdAt: Date.now() };
    set((s) => ({
      // Prune from the front: oldest first, newest kept.
      sessions: [...s.sessions, session].slice(-MAX_SESSIONS),
      activeId: id,
    }));
    return id;
  },

  switchTo: (id) => {
    if (get().sessions.some((s) => s.id === id)) set({ activeId: id });
  },

  deleteSession: (id) => {
    const { sessions, activeId } = get();
    if (!sessions.some((s) => s.id === id)) return;

    const remaining = sessions.filter((s) => s.id !== id);
    set({
      sessions: remaining,
      activeId: activeId === id ? (remaining[remaining.length - 1]?.id ?? null) : activeId,
    });
  },

  addTurn: (role, text) => {
    // Asking a question should not require choosing to start a session first.
    if (!get().activeId) get().newSession();
    const activeId = get().activeId;

    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === activeId
          ? {
              ...session,
              title:
                session.title === UNTITLED && role === "user"
                  ? titleFrom(text)
                  : session.title,
              turns: [...session.turns, { role, text }],
            }
          : session,
      ),
    }));
  },

  appendToLastAssistant: (text) => {
    if (!get().activeId) get().newSession();
    const activeId = get().activeId;

    set((s) => ({
      sessions: s.sessions.map((session) => {
        if (session.id !== activeId) return session;
        const last = session.turns[session.turns.length - 1];
        // Append to the open assistant turn rather than starting a new one
        // per token, or the log becomes one turn per character.
        if (last?.role === "assistant") {
          return {
            ...session,
            turns: [...session.turns.slice(0, -1), { ...last, text: last.text + text }],
          };
        }
        return { ...session, turns: [...session.turns, { role: "assistant", text }] };
      }),
    }));
  },

  setBusy: (busy) => set({ busy }),

  setError: (error) => set({ error }),

  addTool: (request) =>
    set((s) =>
      // Guard against a duplicate id: a re-emitted event would otherwise
      // stack two identical approval cards on top of each other.
      s.tools.some((t) => t.id === request.id)
        ? s
        : { tools: [...s.tools, request] },
    ),

  clearTool: (id) => set((s) => ({ tools: s.tools.filter((t) => t.id !== id) })),

  setProvider: (provider) => set({ provider }),
}));
