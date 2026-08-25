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
          // A tablist may contain role=tab elements, or presentation wrappers
          // that contain one. That is what lets the close button sit beside
          // its tab without becoming a second child of the tablist.
          <div key={tab.id} className="tabbar__slot" role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className="tabbar__tab"
              onClick={() => focusTab(tab.id)}
            >
              {tab.title}
            </button>
            <button
              type="button"
              className="tabbar__close"
              aria-label={`Close ${tab.title}`}
              onClick={() => closeTab(tab.id)}
            >
              ×
            </button>
          </div>
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
