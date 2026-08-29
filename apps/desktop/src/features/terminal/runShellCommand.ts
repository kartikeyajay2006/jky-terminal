import { newId, nowIso, useDashboard } from "../dashboard/dashboardStore";
import { applyTheme, saveTheme, THEMES, type ThemeId } from "../../app/theme";
import { useNav } from "../../app/navStore";
import {
  byReminderTime,
  fail,
  isClockTime,
  ok,
  resolveHandle,
  type CommandResult,
  type ShellCommand,
} from "./shellCommand";

/**
 * Performing a command the shell sent.
 *
 * Every one goes through the same dashboard store the panels use, so a note
 * written from a terminal appears in the Notes panel immediately and is saved
 * by exactly the same path. There is no second way to write a note.
 *
 * Each returns one line to print back into the terminal. That line is the
 * whole feedback channel — the shell cannot see the result of an escape
 * sequence — so it has to say what actually happened rather than that the
 * message was sent.
 */
export async function runShellCommand(command: ShellCommand): Promise<CommandResult> {
  const { verb, args } = command;
  const store = useDashboard.getState();

  switch (verb) {
    // --- notes ---
    case "note.new": {
      const title = args.join(" ").trim();
      if (!title) return fail("usage: jky note new <title>");
      const now = nowIso();
      await store.saveNote({
        id: newId("note"),
        title,
        body: "",
        created_at: now,
        updated_at: now,
      });
      return ok(`note “${title}” created`);
    }

    case "note.write": {
      const [handle, ...rest] = args;
      const text = rest.join(" ");
      const note = resolveHandle(useDashboard.getState().notes, handle ?? "");
      if (!note) return fail(`no note ${handle ?? ""} — try jky notes`);
      if (!text.trim()) return fail("usage: jky note write <n> <text>");

      // Appended, not replaced. A command that silently discarded a note's
      // existing body the moment you added a line to it would be a trap.
      const body = note.body ? `${note.body}\n${text}` : text;
      await store.saveNote({ ...note, body, updated_at: nowIso() });
      return ok(`added a line to “${note.title}”`);
    }

    case "note.rename": {
      const [handle, ...rest] = args;
      const title = rest.join(" ").trim();
      const note = resolveHandle(useDashboard.getState().notes, handle ?? "");
      if (!note) return fail(`no note ${handle ?? ""} — try jky notes`);
      if (!title) return fail("usage: jky note rename <n> <title>");

      await store.saveNote({ ...note, title, updated_at: nowIso() });
      return ok(`renamed to “${title}”`);
    }

    case "note.rm": {
      const note = resolveHandle(useDashboard.getState().notes, args[0] ?? "");
      if (!note) return fail(`no note ${args[0] ?? ""} — try jky notes`);
      await store.deleteNote(note.id);
      return ok(`deleted “${note.title}”`);
    }

    // --- todos ---
    case "todo.add": {
      const text = args.join(" ").trim();
      if (!text) return fail("usage: jky todo add <text>");
      await store.saveTodo({
        id: newId("todo"),
        text,
        done: false,
        created_at: nowIso(),
      });
      return ok(`todo “${text}” added`);
    }

    case "todo.done":
    case "todo.undone": {
      const done = verb === "todo.done";
      const todo = resolveHandle(useDashboard.getState().todos, args[0] ?? "");
      if (!todo) return fail(`no todo ${args[0] ?? ""} — try jky todos`);
      await store.saveTodo({ ...todo, done });
      return ok(`“${todo.text}” marked ${done ? "done" : "not done"}`);
    }

    case "todo.rm": {
      const todo = resolveHandle(useDashboard.getState().todos, args[0] ?? "");
      if (!todo) return fail(`no todo ${args[0] ?? ""} — try jky todos`);
      await store.deleteTodo(todo.id);
      return ok(`deleted “${todo.text}”`);
    }

    // --- reminders ---
    case "reminder.add": {
      const [at, ...rest] = args;
      const text = rest.join(" ").trim();
      if (!at || !isClockTime(at)) {
        return fail("usage: jky reminder add <HH:MM> <text>");
      }
      if (!text) return fail("usage: jky reminder add <HH:MM> <text>");

      await store.saveReminder({
        id: newId("reminder"),
        text,
        at: at.trim(),
        done: false,
      });
      return ok(`reminder “${text}” set for ${at.trim()}`);
    }

    case "reminder.done":
    case "reminder.undone": {
      const done = verb === "reminder.done";
      // Listed by time of day, so the handle has to resolve the same way or
      // it ticks off whichever happens to be first in the array.
      const reminder = resolveHandle(
        useDashboard.getState().reminders,
        args[0] ?? "",
        byReminderTime,
      );
      if (!reminder) return fail(`no reminder ${args[0] ?? ""} — try jky reminders`);
      await store.saveReminder({ ...reminder, done });
      return ok(`“${reminder.text}” marked ${done ? "done" : "not done"}`);
    }

    case "reminder.rm": {
      const reminder = resolveHandle(
        useDashboard.getState().reminders,
        args[0] ?? "",
        byReminderTime,
      );
      if (!reminder) return fail(`no reminder ${args[0] ?? ""} — try jky reminders`);
      await store.deleteReminder(reminder.id);
      return ok(`deleted “${reminder.text}”`);
    }

    // --- the app itself ---
    case "theme": {
      const wanted = (args[0] ?? "").trim().toLowerCase();
      if (!wanted) {
        return fail(`usage: jky theme <${THEMES.map((t) => t.id).join("|")}>`);
      }
      const theme = THEMES.find(
        (t) => t.id === wanted || t.label.toLowerCase() === wanted,
      );
      if (!theme) {
        return fail(`no theme “${wanted}” — one of ${THEMES.map((t) => t.id).join(", ")}`);
      }
      applyTheme(theme.id as ThemeId);
      saveTheme(theme.id as ThemeId);
      return ok(`theme set to ${theme.label}`);
    }

    case "open": {
      const section = (args[0] ?? "").trim().toLowerCase();
      const known = ["dashboard", "terminal", "assistant", "games", "settings"];
      if (!known.includes(section)) {
        return fail(`usage: jky open <${known.join("|")}>`);
      }
      useNav.getState().go(section, args[1]?.trim().toLowerCase());
      return ok(`opened ${section}`);
    }

    default:
      return fail(`jky: unknown command — try jky commands`);
  }
}
