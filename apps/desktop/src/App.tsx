import { useState } from "react";
import { Shell } from "./app/Shell";
import { TabBar } from "./app/TabBar";
import { useTabs } from "./app/tabStore";
import { ProviderVault } from "./features/settings/ProviderVault";
import { Terminal } from "./features/terminal/Terminal";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [section, setSection] = useState("terminal");
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  return (
    <Shell activeId={section} onSelect={setSection}>
      {section === "providers" ? (
        <ProviderVault />
      ) : (
        <div className="workspace">
          <TabBar />
          <div className="workspace__body">
            {tabs.map((tab) => (
              // Kept mounted but hidden. A terminal that unmounts loses its
              // scrollback and kills its shell.
              <div key={tab.id} className="workspace__pane" hidden={tab.id !== activeId}>
                <Terminal tabId={tab.id} />
              </div>
            ))}
            {tabs.length === 0 && (
              <p className="workspace__empty">
                No terminal open. Choose <b>+ New terminal</b> above, or press{" "}
                <kbd>Ctrl</kbd>+<kbd>T</kbd>.
              </p>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
