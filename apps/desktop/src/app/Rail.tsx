import { IdentityMark } from "./IdentityMark";

export interface RailItem {
  id: string;
  label: string;
  /** A text glyph rather than an icon font: no extra asset, themes for free. */
  glyph: string;
}

export const RAIL_ITEMS: RailItem[] = [
  { id: "dashboard", label: "Dashboard", glyph: "⌂" },
  { id: "terminal", label: "Terminal", glyph: "❯" },
  { id: "assistant", label: "Assistant", glyph: "✦" },
  { id: "games", label: "Games", glyph: "◈" },
  { id: "apps", label: "Apps", glyph: "⊞" },
];

/// Settings sits apart from the workspace destinations, pinned to the bottom
/// the way it does in every editor — it is where you go to configure the
/// tools, not one of the tools.
export const RAIL_FOOTER: RailItem[] = [
  { id: "settings", label: "Settings", glyph: "⚙" },
];

interface RailProps {
  activeId: string;
  onSelect: (id: string) => void;
}

export function Rail({ activeId, onSelect }: RailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <IdentityMark />
      <ul className="rail__list">
        {RAIL_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rail__item"
              aria-current={item.id === activeId ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="rail__glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="rail__label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <ul className="rail__list rail__list--footer">
        {RAIL_FOOTER.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rail__item"
              aria-current={item.id === activeId ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="rail__glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="rail__label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
