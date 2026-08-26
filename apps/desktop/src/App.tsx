import { useEffect, useState } from "react";
import { Shell } from "./app/Shell";
import { TabBar } from "./app/TabBar";
import { useAsk } from "./app/askStore";
import { useTabs } from "./app/tabStore";
import { useShortcuts } from "./app/useShortcuts";
import { Assistant } from "./features/assistant/Assistant";
import { Settings } from "./features/settings/Settings";
import { Terminal } from "./features/terminal/Terminal";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [section, setSection] = useState("terminal");
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  useShortcuts();

  // A question raised from a terminal pulls the assistant into view. Asking
  // and then having to find the answer would defeat the point of asking from
  // where you already are.
  const pendingQuestion = useAsk((s) => s.pending);
  useEffect(() => {
    if (pendingQuestion) setSection("assistant");
  }, [pendingQuestion]);

  return (
    <Shell activeId={section} onSelect={setSection}>
      {section === "settings" ? (
        <Settings />
      ) : section === "assistant" ? (
        <Assistant />
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
