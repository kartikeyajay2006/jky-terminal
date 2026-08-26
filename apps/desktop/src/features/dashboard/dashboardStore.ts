import { create } from "zustand";
import { getPlatform, type Event, type Note, type Reminder, type Todo } from "../../platform";

/**
 * The dashboard's data, mirrored from disk.
 *
 * Every mutation sends the record to the backend and takes the whole
 * collection back as the new truth, rather than editing the local copy and
 * hoping the write succeeded. A save that fails leaves the UI showing what is
 * actually stored, and says so.
 */

export type Collection = "notes" | "todos" | "events" | "reminders";

interface DashboardState {
  notes: Note[];
  todos: Todo[];
  events: Event[];
  reminders: Reminder[];
  loaded: boolean;
  /** Which collection, if any, failed — so one bad file does not blank the
   *  whole dashboard. */
  errors: Partial<Record<Collection, string>>;

  load: () => Promise<void>;
  saveNote: (note: Note) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  saveTodo: (todo: Todo) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  saveEvent: (event: Event) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  saveReminder: (reminder: Reminder) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
}

let counter = 0;
/** Unique within a session and stable once written. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function nowIso(): string {
  // Seconds, no milliseconds: the same shape the Rust side validates.
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

function describe(e: unknown): string {
  // Tauri rejects with a plain string, so `instanceof Error` throws the real
  // message away.
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export const useDashboard = create<DashboardState>((set) => {
  /** Run one collection's operation and fold the result into state. */
  async function apply<T>(
    key: Collection,
    run: () => Promise<T[]>,
  ): Promise<void> {
    try {
      const records = await run();
      set((s) => ({
        [key]: records,
        errors: { ...s.errors, [key]: undefined },
      }) as unknown as Partial<DashboardState>);
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [key]: describe(e) } }));
    }
  }

  return {
    notes: [],
    todos: [],
    events: [],
    reminders: [],
    loaded: false,
    errors: {},

    async load() {
      const store = getPlatform().store;
      // All four in parallel, and each folded in on its own. One unreadable
      // file costs you that collection, not the dashboard.
      await Promise.all([
        apply("notes", () => store.notes.list()),
        apply("todos", () => store.todos.list()),
        apply("events", () => store.events.list()),
        apply("reminders", () => store.reminders.list()),
      ]);
      set({ loaded: true });
    },

    saveNote: (note) => apply("notes", () => getPlatform().store.notes.save(note)),
    deleteNote: (id) => apply("notes", () => getPlatform().store.notes.remove(id)),
    saveTodo: (todo) => apply("todos", () => getPlatform().store.todos.save(todo)),
    deleteTodo: (id) => apply("todos", () => getPlatform().store.todos.remove(id)),
    saveEvent: (event) => apply("events", () => getPlatform().store.events.save(event)),
    deleteEvent: (id) => apply("events", () => getPlatform().store.events.remove(id)),
    saveReminder: (r) => apply("reminders", () => getPlatform().store.reminders.save(r)),
    deleteReminder: (id) =>
      apply("reminders", () => getPlatform().store.reminders.remove(id)),
  };
});
