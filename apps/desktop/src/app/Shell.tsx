import { useEffect, useState, type ReactNode } from "react";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { applyTheme, loadTheme, saveTheme, type ThemeId } from "./theme";
import "./Shell.css";

interface ShellProps {
  children: ReactNode;
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function Shell({ children, activeId = "terminal", onSelect }: ShellProps) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function changeTheme(id: ThemeId) {
    setTheme(id);
    saveTheme(id);
  }

  return (
    <div className="shell">
      <Rail activeId={activeId} onSelect={onSelect ?? (() => {})} />
      <main className="shell__workspace">{children}</main>
      <StatusBar theme={theme} onThemeChange={changeTheme} shellName={shellLabel()} />
    </div>
  );
}

/**
 * A best-effort guess at the user's shell, for display only. The authoritative
 * answer comes from the Rust side once a PTY is running; this is what the
 * status bar shows before then.
 */
function shellLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "powershell";
  if (ua.includes("Mac")) return "zsh";
  return "bash";
}
