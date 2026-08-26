import { Select } from "../components/Select";
import { getPlatform } from "../platform";
import { THEMES, type ThemeId } from "./theme";

interface StatusBarProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  shellName: string;
}

export function StatusBar({ theme, onThemeChange, shellName }: StatusBarProps) {
  const platform = getPlatform();
  const live = platform.kind === "tauri";

  return (
    <footer className="status">
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
      <span className="status__item">
        <span className="status__key">shell</span> {shellName}
      </span>
      <span className="status__spacer" />
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
