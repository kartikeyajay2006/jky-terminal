import { useNav } from "../../app/navStore";
import { useTabs } from "../../app/tabStore";
import { THEMES, applyTheme, saveTheme, type ThemeId } from "../../app/theme";
import { useOpenGame } from "../games/openStore";
import { GAMES } from "../games/Games";
import { SECTIONS } from "../dashboard/Dashboard";
import { useDashboard } from "../dashboard/dashboardStore";
import { runShellCommand } from "../terminal/runShellCommand";
import { byReminderTime, type CommandResult } from "../terminal/shellCommand";
import type { GameId } from "../games/scores";

export type PaletteGroup =
  | "Go to"
  | "Games"
  | "Terminal"
  | "Theme"
  | "Notes"
  | "Todos"
  | "Reminders";

/** A command that needs a line of text before it can run. */
export interface PaletteAsk {
  /** Shown in the input while it is empty. */
  placeholder: string;
  /**
   * A returned failure keeps the palette open and shows the message, so a
   * mistyped reminder time says so rather than appearing to do nothing.
   */
  run: (value: string) => CommandResult | void | Promise<CommandResult | void>;
}

export interface PaletteCommand {
  id: string;
  /** What the row says. Also what is matched against, with `group`. */
  label: string;
  group: PaletteGroup;
  /** A keyboard shortcut to show on the right, when one exists. */
  hint?: string;
  /** Runs the moment it is chosen. */
  run?: () => void;
  /** Asks for a line first, then runs with it. Mutually exclusive with `run`. */
  ask?: PaletteAsk;
}

/** The whole app, as a flat list of things you can do from one box. */
export function buildCommands(): PaletteCommand[] {
  const nav = useNav.getState();
  const out: PaletteCommand[] = [];

  // --- rail destinations ---
  const sections: Array<{ id: string; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "terminal", label: "Terminal" },
    { id: "assistant", label: "Assistant" },
    { id: "games", label: "Games" },
    { id: "settings", label: "Settings" },
  ];
  for (const s of sections) {
    out.push({
      id: `go:${s.id}`,
      label: s.label,
      group: "Go to",
      run: () => nav.go(s.id),
    });
  }

  // --- dashboard panels, named with their section so "dash cal" finds one ---
  for (const panel of SECTIONS) {
    out.push({
      id: `go:dashboard:${panel.id}`,
      label: `Dashboard · ${panel.label}`,
      group: "Go to",
      run: () => nav.go("dashboard", panel.id),
    });
  }

  // --- settings panels ---
  for (const panel of [
    { id: "appearance", label: "Appearance" },
    { id: "providers", label: "Providers" },
    { id: "commands", label: "Commands" },
  ]) {
    out.push({
      id: `go:settings:${panel.id}`,
      label: `Settings · ${panel.label}`,
      group: "Go to",
      run: () => nav.go("settings", panel.id),
    });
  }

  // --- games ---
  out.push({
    id: "game:arcade",
    label: "Arcade",
    group: "Games",
    run: () => nav.go("games", "arcade"),
  });
  for (const game of GAMES) {
    out.push({
      id: `game:${game.id}`,
      label: `Play ${game.label}`,
      group: "Games",
      // Routed through the games' own store rather than nav, because that is
      // the path the shell command already uses and it is already tested.
      run: () => useOpenGame.getState().open(game.id as GameId),
    });
  }

  // --- terminal ---
  out.push({
    id: "term:new",
    label: "New terminal",
    group: "Terminal",
    hint: "Ctrl+T",
    run: () => {
      const tabs = useTabs.getState();
      tabs.openTab("terminal", `Terminal ${tabs.tabs.length + 1}`);
      nav.go("terminal");
    },
  });
  out.push({
    id: "term:close",
    label: "Close terminal tab",
    group: "Terminal",
    hint: "Ctrl+W",
    run: () => {
      const { activeId, closeTab } = useTabs.getState();
      if (activeId) closeTab(activeId);
    },
  });

  // --- writing, through the same verbs the shell sends ---
  //
  // Every row here calls `runShellCommand`, so there is one implementation of
  // "add a todo" rather than two that drift. The handle is the row's position
  // in the listing, which is what the verb resolves and what `jky todos`
  // prints beside it.
  //
  // Deleting is deliberately absent. In the shell you type `rm` and a number;
  // here a fuzzy match plus one Enter is close enough to an accident, and the
  // store's rule is that nothing goes until the user says so. Deletion stays
  // in the Dashboard, which asks first.
  const dash = useDashboard.getState();

  out.push({
    id: "note:new",
    label: "New note…",
    group: "Notes",
    ask: {
      placeholder: "Title of the note",
      run: (title) => runShellCommand({ verb: "note.new", args: [title] }),
    },
  });
  out.push({
    id: "todo:new",
    label: "New todo…",
    group: "Todos",
    ask: {
      placeholder: "What needs doing",
      run: (text) => runShellCommand({ verb: "todo.add", args: [text] }),
    },
  });
  out.push({
    id: "reminder:new",
    label: "New reminder…",
    group: "Reminders",
    ask: {
      // One line rather than two boxes: the time is the first word, exactly
      // as the shell takes it.
      placeholder: "07:00 Go for a run",
      run: (line) => {
        const [at, ...rest] = line.trim().split(/\s+/);
        return runShellCommand({
          verb: "reminder.add",
          args: [at ?? "", rest.join(" ")],
        });
      },
    },
  });

  dash.notes.forEach((note, i) => {
    const handle = String(i + 1);
    out.push({
      id: `note:write:${note.id}`,
      label: `Append to · ${note.title}`,
      group: "Notes",
      ask: {
        placeholder: `A line to add to “${note.title}”`,
        run: (text) => runShellCommand({ verb: "note.write", args: [handle, text] }),
      },
    });
    out.push({
      id: `note:rename:${note.id}`,
      label: `Rename · ${note.title}`,
      group: "Notes",
      ask: {
        placeholder: "A new title",
        run: (title) => runShellCommand({ verb: "note.rename", args: [handle, title] }),
      },
    });
  });

  dash.todos.forEach((todo, i) => {
    const handle = String(i + 1);
    out.push({
      id: `todo:toggle:${todo.id}`,
      label: `${todo.done ? "Untick" : "Tick"} · ${todo.text}`,
      group: "Todos",
      run: () => {
        void runShellCommand({
          verb: todo.done ? "todo.undone" : "todo.done",
          args: [handle],
        });
      },
    });
  });

  // Sorted the way the listing is, so the handle means the same thing here.
  [...dash.reminders].sort(byReminderTime).forEach((reminder, i) => {
    const handle = String(i + 1);
    out.push({
      id: `reminder:toggle:${reminder.id}`,
      label: `${reminder.done ? "Untick" : "Tick"} · ${reminder.at} ${reminder.text}`,
      group: "Reminders",
      run: () => {
        void runShellCommand({
          verb: reminder.done ? "reminder.undone" : "reminder.done",
          args: [handle],
        });
      },
    });
  });

  // --- themes ---
  for (const theme of THEMES) {
    out.push({
      id: `theme:${theme.id}`,
      label: `Theme · ${theme.label}`,
      group: "Theme",
      run: () => {
        applyTheme(theme.id as ThemeId);
        saveTheme(theme.id as ThemeId);
      },
    });
  }

  return out;
}

/** What a command is matched against: its label and the group it sits in. */
export function searchText(command: PaletteCommand): string {
  return `${command.label} ${command.group}`;
}
