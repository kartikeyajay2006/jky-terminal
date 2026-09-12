import { Select } from "../components/Select";
import { getPlatform } from "../platform";
import { THEMES, type ThemeId } from "./theme";

interface StatusBarProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  shellName: string;
  /** Focus mode: the bar floats over the work instead of sitting under it. */
  hud?: boolean;
  onLeaveHud?: () => void;
}

export function StatusBar({
  theme,
  onThemeChange,
  shellName,
  hud = false,
  onLeaveHud,
}: StatusBarProps) {
  const platform = getPlatform();
  const live = platform.kind === "tauri";

  return (
    <footer className="status" data-hud={hud ? "on" : undefined}>
      {/* Which backend is actually live. This was invisible once, and the
          desktop app silently ran the browser mock for an entire phase:
          keys in memory instead of the keychain, a fake echo shell instead
          of a terminal. It is on screen now so that cannot recur unseen. */}
      <span
        className="status__item status__backend"
        data-live={live}
        title={
          live
            ? "Connected to the JKY Terminal backend"
            : "Browser preview — no real shell or keychain"
        }
      >
        <span aria-hidden="true">{live ? "●" : "○"}</span>
        {live ? "native" : "preview"}
      </span>
      {/* Absent until the shell is known, rather than a label with nothing
          after it. In the browser preview there is no shell to name at all. */}
      {shellName && (
        <span className="status__item">
          <span className="status__key">shell</span> {shellName}
        </span>
      )}
      <span className="status__spacer" />
      {/* The way out, and the only chrome focus mode leaves behind. A mode
          whose exit is a chord you have to remember is a mode people get
          stuck in and then stop using. */}
      {hud && (
        <button type="button" className="status__item status__leave" onClick={onLeaveHud}>
          <span aria-hidden="true">✕</span> leave focus
        </button>
      )}
      <span className="status__item status__theme">
        <span className="status__key">theme</span>
        <Select
          label="Theme"
          value={theme}
          options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
          onChange={(id) => onThemeChange(id as ThemeId)}
        />
      </span>
    </footer>
  );
}
