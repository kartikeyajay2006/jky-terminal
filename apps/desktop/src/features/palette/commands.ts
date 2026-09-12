import { useNav } from "../../app/navStore";
import { chordFor } from "../../app/keymapStore";
import { useTabs } from "../../app/tabStore";
import { useRail } from "../../app/railStore";
import { useHud } from "../../app/hudStore";
import { THEMES, applyTheme, saveTheme, type ThemeId } from "../../app/theme";
import { useOpenGame } from "../games/openStore";
import { GAMES } from "../games/Games";
import { SECTIONS } from "../dashboard/Dashboard";
import { TOOLS } from "../developer/registry";
import { useDashboard } from "../dashboard/dashboardStore";
import { runShellCommand } from "../terminal/runShellCommand";
import { byReminderTime, type CommandResult } from "../terminal/shellCommand";
import type { GameId } from "../games/scores";
import type { Direction } from "../terminal/panes/tree";
import { getPlatform, type Folder, type RemoteHost, type SavedWorkspace } from "../../platform";

export type PaletteGroup =
  | "Go to"
  | "Games"
  | "Terminal"
  | "Workspaces"
  | "Remote"
  | "Editor"
  | "Theme"
  | "Notes"
  | "Todos"
  | "Reminders";

/**
 * What the palette cannot read for itself.
 *
 * Workspaces and hosts live behind IPC, and `buildCommands` is called while
 * the palette is opening — so they are fetched by the palette and handed in.
 * Absent means the list is built without them rather than not built at all: a
 * palette that waited for a disk read before drawing would be a palette that
 * feels slow on the one keystroke that has to feel instant.
 */
export interface PaletteContext {
  workspaces?: SavedWorkspace[];
  activeWorkspace?: string | null;
  hosts?: RemoteHost[];
  folders?: Folder[];
}

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
export function buildCommands(context: PaletteContext = {}): PaletteCommand[] {
  const nav = useNav.getState();
  const out: PaletteCommand[] = [];

  // --- rail destinations ---
  const sections: Array<{ id: string; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "terminal", label: "Terminal" },
    { id: "history", label: "History" },
    { id: "remote", label: "Remote" },
    { id: "editor", label: "Editor" },
    { id: "workspaces", label: "Workspaces" },
    { id: "assistant", label: "Assistant" },
    { id: "games", label: "Games" },
    { id: "developer", label: "Developer Tools" },
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

  // --- one entry per tool, so "json" finds the JSON tool rather than only
  // the section holding it ---
  for (const tool of TOOLS) {
    out.push({
      id: `go:developer:${tool.id}`,
      label: `Developer Tools · ${tool.name}`,
      group: "Go to",
      run: () => nav.go("developer", tool.id),
    });
  }

  // --- settings panels ---
  for (const panel of [
    { id: "appearance", label: "Appearance" },
    { id: "terminal", label: "Terminal" },
    { id: "keyboard", label: "Keyboard" },
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
    id: "app:rail",
    label: "Show or hide the sidebar",
    group: "Terminal",
    hint: chordFor("rail-toggle"),
    run: () => useRail.getState().toggle(),
  });
  out.push({
    id: "app:hud",
    label: "Focus mode",
    group: "Terminal",
    hint: chordFor("hud-toggle"),
    run: () => useHud.getState().toggle(),
  });
  out.push({
    id: "term:new",
    label: "New terminal",
    group: "Terminal",
    hint: chordFor("tab-new"),
    run: () => {
      const tabs = useTabs.getState();
      tabs.openTab("terminal", `Terminal ${tabs.tabs.length + 1}`);
      nav.go("terminal");
    },
  });

  // The pane commands act on whichever terminal has the keyboard, so the
  // palette can do everything the shortcuts do — which is what makes the
  // shortcuts discoverable rather than folklore.
  const splits: Array<{ id: string; label: string; hint: string; dir: Direction }> = [
    {
      id: "term:split-right",
      label: "Split terminal right",
      hint: chordFor("pane-split-right"),
      dir: "row",
    },
    {
      id: "term:split-down",
      label: "Split terminal down",
      hint: chordFor("pane-split-down"),
      dir: "column",
    },
  ];
  for (const split of splits) {
    out.push({
      id: split.id,
      label: split.label,
      group: "Terminal",
      hint: split.hint,
      run: () => {
        const state = useTabs.getState();
        const tab = state.tabs.find((t) => t.id === state.activeId);
        if (!tab) return;
        state.splitPane(tab.id, tab.focusedPane, split.dir);
        nav.go("terminal");
      },
    });
  }
  out.push({
    id: "term:close-pane",
    label: "Close terminal pane",
    group: "Terminal",
    hint: chordFor("pane-close"),
    run: () => {
      const state = useTabs.getState();
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (tab) state.closePane(tab.id, tab.focusedPane);
    },
  });
  out.push({
    id: "term:close",
    label: "Close terminal tab",
    group: "Terminal",
    hint: chordFor("tab-close"),
    run: () => {
      const { activeId, closeTab } = useTabs.getState();
      if (activeId) closeTab(activeId);
    },
  });

  // --- workspaces, hosts and folders ---
  //
  // These are the things the palette can only know by being told. Each row
  // goes through the same call the section behind it uses, so switching a
  // workspace from here and clicking it there are one code path.
  for (const workspace of context.workspaces ?? []) {
    out.push({
      id: `wsp:${workspace.id}`,
      label:
        workspace.id === context.activeWorkspace
          ? `${workspace.name} (current)`
          : workspace.name,
      group: "Workspaces",
      hint: `${workspace.folders.length} folders`,
      run: () => {
        void getPlatform()
          .workspaces.activate(workspace.id)
          .then((applied) => {
            const tabs = useTabs.getState();
            for (let i = 0; i < applied.workspace.terminals; i += 1) {
              tabs.openTab("terminal", `${applied.workspace.name} ${i + 1}`);
            }
            nav.go(applied.workspace.terminals > 0 ? "terminal" : "editor");
          })
          .catch(() => nav.go("workspaces"));
      },
    });
  }
  out.push({
    id: "wsp:manage",
    label: "Manage workspaces",
    group: "Workspaces",
    run: () => nav.go("workspaces"),
  });

  for (const host of context.hosts ?? []) {
    out.push({
      id: `host:${host.id}`,
      label: `Connect to ${host.label || host.address}`,
      group: "Remote",
      hint: host.user ? `${host.user}@${host.address}` : host.address,
      run: () => {
        useTabs.getState().openRemoteTab(host.id, host.label || host.address);
        nav.go("terminal");
      },
    });
  }
  out.push({
    id: "host:manage",
    label: "Manage saved machines",
    group: "Remote",
    run: () => nav.go("remote"),
  });

  for (const folder of context.folders ?? []) {
    out.push({
      id: `folder:${folder.root}`,
      label: `Open ${folder.name} in the editor`,
      group: "Editor",
      hint: folder.available ? folder.root : "missing",
      run: () => nav.go("editor"),
    });
  }
  out.push({
    id: "editor:open",
    label: "Open a folder",
    group: "Editor",
    run: () => nav.go("editor"),
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
