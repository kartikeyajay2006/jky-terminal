export interface RailItem {
  id: string;
  label: string;
  /** A text glyph rather than an icon font: no extra asset, themes for free. */
  glyph: string;
}

export const RAIL_ITEMS: RailItem[] = [
  { id: "terminal", label: "Terminal", glyph: "❯" },
  { id: "assistant", label: "Assistant", glyph: "✦" },
  { id: "providers", label: "Providers", glyph: "◈" },
];

interface RailProps {
  activeId: string;
  onSelect: (id: string) => void;
}

export function Rail({ activeId, onSelect }: RailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <div className="rail__mark" aria-hidden="true">
        J
      </div>
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
    </nav>
  );
}
