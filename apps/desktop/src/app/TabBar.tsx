import { useTabs } from "./tabStore";

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const focusTab = useTabs((s) => s.focusTab);
  const closeTab = useTabs((s) => s.closeTab);
  const openTab = useTabs((s) => s.openTab);

  return (
    <div className="tabbar">
      <div className="tabbar__tabs" role="tablist" aria-label="Open tabs">
        {tabs.map((tab) => (
          // A tablist may contain only role=tab elements — not a wrapper with
          // a second button in it. So the close affordance lives inside the
          // tab, following the WAI-ARIA deletable-tabs pattern: a decorative
          // glyph for the mouse, and Delete/Backspace for the keyboard, which
          // aria-keyshortcuts advertises to assistive technology.
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            aria-keyshortcuts="Delete"
            className="tabbar__tab"
            onClick={(e) => {
              if ((e.target as HTMLElement).dataset.close === "true") closeTab(tab.id);
              else focusTab(tab.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                closeTab(tab.id);
              }
            }}
          >
            <span className="tabbar__title">{tab.title}</span>
            <span className="tabbar__close" data-close="true" aria-hidden="true">
              ×
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="tabbar__add"
        onClick={() => openTab("terminal", `Terminal ${tabs.length + 1}`)}
      >
        + New terminal
      </button>
    </div>
  );
}
