/**
 * The tabs above an open board.
 *
 * A tablist may contain only `role=tab` elements — not a wrapper holding a
 * second button — so the close affordance lives *inside* the tab: a
 * decorative glyph for the mouse, and Delete or Backspace for the keyboard,
 * which `aria-keyshortcuts` advertises to assistive technology. The terminal
 * tabs already work this way.
 */
export interface TabItem {
  id: string;
  name: string;
  glyph: string;
  /** A theme token name — `accent`, `mint`. Never a colour. */
  accent: string;
}

export function TabStrip({
  label,
  tabs,
  activeId,
  onSelect,
  onClose,
  onShowBoard,
  addLabel,
}: {
  /** What this strip is, for anyone who cannot see it. */
  label: string;
  tabs: TabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onShowBoard: () => void;
  /** Names the "+" button. Not the board's own name, which is taken. */
  addLabel: string;
}) {
  if (tabs.length === 0) return null;

  return (
    <div className="board__tabstrip">
      <div className="board__tabs" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            aria-keyshortcuts="Delete"
            className="board__tab"
            style={{ ["--app-accent" as string]: `var(--${tab.accent})` }}
            onClick={(e) => {
              if ((e.target as HTMLElement).dataset.close === "true") onClose(tab.id);
              else onSelect(tab.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
          >
            <span className="board__tab-glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            <span className="board__tab-name">{tab.name}</span>
            <span className="board__tab-close" data-close="true" aria-hidden="true">
              ×
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="board__tab-add"
        // Not the board's own name: the header already has one of those, and
        // two controls with the same name are ambiguous to a screen reader as
        // well as to a test.
        aria-label={addLabel}
        onClick={onShowBoard}
      >
        +
      </button>
    </div>
  );
}
