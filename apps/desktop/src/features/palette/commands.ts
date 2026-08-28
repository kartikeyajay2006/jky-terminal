import { useNav } from "../../app/navStore";
import { useTabs } from "../../app/tabStore";
import { THEMES, applyTheme, saveTheme, type ThemeId } from "../../app/theme";
import { useOpenGame } from "../games/openStore";
import { GAMES } from "../games/Games";
import { SECTIONS } from "../dashboard/Dashboard";
import type { GameId } from "../games/scores";

export type PaletteGroup = "Go to" | "Games" | "Terminal" | "Theme";

export interface PaletteCommand {
  id: string;
  /** What the row says. Also what is matched against, with `group`. */
  label: string;
  group: PaletteGroup;
  /** A keyboard shortcut to show on the right, when one exists. */
  hint?: string;
  run: () => void;
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
