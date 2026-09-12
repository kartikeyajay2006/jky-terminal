import { useEffect, useState, type ReactNode } from "react";
import { Rail } from "./Rail";
import { getPlatform } from "../platform";
import { useRail } from "./railStore";
import { useHud } from "./hudStore";
import { overallActivity, useActivity } from "../features/terminal/activity";
import { StatusBar } from "./StatusBar";
import { applyTheme, loadTheme, saveTheme, type ThemeId } from "./theme";
import { Notifications } from "../features/notifications/Notifications";
import { Camera } from "../features/capture/Camera";
import "./Shell.css";

interface ShellProps {
  children: ReactNode;
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function Shell({ children, activeId = "terminal", onSelect }: ShellProps) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  // The grid owns the rail's width, so the shell has to know as well as the
  // rail does — a rail that narrowed inside a column that did not would just
  // leave a gap.
  const collapsed = useRail((s) => s.collapsed);
  // Everything but the work. The shell answers to it rather than each piece
  // of chrome removing itself, because what focus mode *is* is a statement
  // about the window, and a window is one thing.
  const hud = useHud((s) => s.on);
  const leaveHud = useHud((s) => s.leave);
  // A command running somewhere, or one that failed. Read here rather than in
  // the rail because the whole window answers to it.
  const activity = overallActivity(useActivity((s) => s.panes));

  /*
   * What shell this actually runs, asked rather than guessed.
   *
   * It used to be inferred from the user agent — Windows meant PowerShell,
   * Mac meant zsh, anything else meant bash — which is a fact about the
   * operating system wearing the name of a fact about the shell, and wrong
   * for everyone on Linux running zsh or anywhere running fish.
   *
   * Empty until the answer arrives, and empty in the browser preview, where
   * there is no shell to name. The bar shows nothing rather than something
   * made up.
   */
  const [shellName, setShellName] = useState("");
  useEffect(() => {
    let live = true;
    void getPlatform()
      .pty.shell()
      .then((name) => {
        if (live) setShellName(name);
      })
      // A status bar that cannot name the shell says nothing about it. There
      // is no error worth showing here and nothing depends on the answer.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function changeTheme(id: ThemeId) {
    setTheme(id);
    saveTheme(id);
  }

  return (
    <div
      className="shell"
      data-rail={collapsed ? "collapsed" : undefined}
      data-hud={hud ? "on" : undefined}
      // What the terminals are doing, said once at the top so anything below
      // can answer to it without being handed the state.
      data-activity={activity === "idle" ? undefined : activity}
    >
      <Rail activeId={activeId} onSelect={onSelect ?? (() => {})} />
      <main className="shell__workspace">{children}</main>
      <StatusBar
        theme={theme}
        onThemeChange={changeTheme}
        shellName={shellName}
        hud={hud}
        onLeaveHud={leaveHud}
      />
      <Camera />
      <Notifications />
    </div>
  );
}

