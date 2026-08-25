import { Select } from "../components/Select";
import { THEMES, type ThemeId } from "./theme";

interface StatusBarProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  shellName: string;
}

export function StatusBar({ theme, onThemeChange, shellName }: StatusBarProps) {
  return (
    <footer className="status">
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
