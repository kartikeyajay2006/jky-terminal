import { useEffect, useState } from "react";
import { Shell } from "./app/Shell";
import { TabBar } from "./app/TabBar";
import { useAsk } from "./app/askStore";
import { useChat } from "./app/chatStore";
import { useTabs } from "./app/tabStore";
import { useShortcuts } from "./app/useShortcuts";
import { Assistant } from "./features/assistant/Assistant";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Settings } from "./features/settings/Settings";
import { Terminal } from "./features/terminal/Terminal";
import { getPlatform } from "./platform";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [section, setSection] = useState("terminal");
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  useShortcuts();

  // Bring back conversations from the last run before anything renders them.
  useEffect(() => {
    useChat.getState().restore();
  }, []);

  // Assistant events are subscribed here, not in the panel. A stream that
  // arrives while the terminal is showing must still land in the session —
  // when the panel owned these, switching away silently dropped the answer.
  useEffect(() => {
    const platform = getPlatform();
    const cleanups: Array<() => void> = [];
    let cancelled = false;
    const chat = useChat.getState();

    void (async () => {
      const subs = await Promise.all([
        platform.ai.onDelta((text) => useChat.getState().appendToLastAssistant(text)),
        platform.ai.onToolRequest((req) => useChat.getState().addTool(req)),
        platform.ai.onToolRan((ran) =>
          useChat
            .getState()
            .appendToLastAssistant(
              `\n▸ ${ran.name} — ${ran.summary}${ran.is_error ? " (failed)" : ""}\n`,
            ),
        ),
        platform.ai.onDone(() => useChat.getState().setBusy(false)),
        platform.ai.onError((message) => {
          useChat.getState().setError(message);
          useChat.getState().setBusy(false);
        }),
      ]);
      if (cancelled) {
        subs.forEach((fn) => fn());
        return;
      }
      cleanups.push(...subs);
    })();

    void chat;
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

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
      ) : section === "dashboard" ? (
        <Dashboard />
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
