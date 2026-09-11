import { IdentityMark } from "./IdentityMark";
import { useRail } from "./railStore";
import { SystemStatus } from "./SystemStatus";

export interface RailItem {
  id: string;
  label: string;
  /** A text glyph rather than an icon font: no extra asset, themes for free. */
  glyph: string;
}

export const RAIL_ITEMS: RailItem[] = [
  { id: "dashboard", label: "Dashboard", glyph: "⌂" },
  { id: "terminal", label: "Terminal", glyph: "❯" },
  { id: "history", label: "History", glyph: "↺" },
  { id: "remote", label: "Remote", glyph: "⇄" },
  { id: "editor", label: "Editor", glyph: "✎" },
  { id: "workspaces", label: "Workspaces", glyph: "▦" },
  { id: "assistant", label: "Assistant", glyph: "✦" },
  { id: "games", label: "Games", glyph: "◈" },
  { id: "apps", label: "Apps", glyph: "⊞" },
  { id: "developer", label: "Developer", glyph: "⌥" },
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
  const collapsed = useRail((s) => s.collapsed);
  const toggle = useRail((s) => s.toggle);

  return (
    <nav className="rail" aria-label="Workspace" data-collapsed={collapsed ? "true" : undefined}>
      <div className="rail__top">
        <IdentityMark />
        {/*
         * Narrows the rail to its glyphs and back.
         *
         * It stays on screen when collapsed, because the only way back is
         * through it — a control that hides itself is a control you have to
         * know about beforehand. `title` as well as the label so the reason
         * is readable with a pointer, where there is no label to read.
         */}
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the section names" : "Hide the section names"}
          title={collapsed ? "Expand" : "Collapse"}
          onClick={toggle}
        >
          <span className="rail__chevron" aria-hidden="true">
            {collapsed ? "›" : "‹"}
          </span>
        </button>
      </div>
      <ul className="rail__list">
        {RAIL_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rail__item"
              aria-current={item.id === activeId ? "page" : undefined}
              // The label is still the accessible name; this is for a pointer,
              // which has nothing to read once the labels are hidden.
              title={item.label}
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

      {/* A readout, not a destination — so it sits with Settings at the foot
          of the rail rather than among the places you can go. */}
      <SystemStatus />

      <ul className="rail__list rail__list--footer">
        {RAIL_FOOTER.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rail__item"
              aria-current={item.id === activeId ? "page" : undefined}
              // The label is still the accessible name; this is for a pointer,
              // which has nothing to read once the labels are hidden.
              title={item.label}
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
