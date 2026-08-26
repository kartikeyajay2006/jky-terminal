import { useCallback, useEffect, useRef, useState } from "react";
import { useAsk } from "../../app/askStore";
import { useChat } from "../../app/chatStore";
import { getPlatform, type AiMessage } from "../../platform";
import { describeError } from "./errors";
import { SessionList } from "./SessionList";
import { ToolCard } from "./ToolCard";
import { Welcome } from "./Welcome";
import "./Assistant.css";

export function Assistant() {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Conversation state lives in the store, not here. When it lived in
  // component state, switching to the terminal unmounted this panel and threw
  // the whole conversation away.
  const sessions = useChat((s) => s.sessions);
  const activeId = useChat((s) => s.activeId);
  const busy = useChat((s) => s.busy);
  const addTurn = useChat((s) => s.addTurn);
  const setBusy = useChat((s) => s.setBusy);

  const turns = sessions.find((s) => s.id === activeId)?.turns ?? [];
  const tools = useChat((s) => s.tools);
  const error = useChat((s) => s.error);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, tools]);

  const submit = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question) return;

      addTurn("user", question);
      setDraft("");
      setBusy(true);
      useChat.getState().setError(null);

      const conversation: AiMessage[] = [
        { role: "user", content: [{ type: "text", text: question }] },
      ];

      try {
        await getPlatform().ai.send(useChat.getState().provider, conversation);
      } catch (e) {
        useChat.getState().setError(describeError(e));
        setBusy(false);
      }
    },
    [addTurn, setBusy],
  );

  // Take a question raised from a terminal. `take` clears it, so switching
  // away and back does not re-ask whatever was asked last.
  const pending = useAsk((s) => s.pending);
  useEffect(() => {
    if (!pending) return;
    const question = useAsk.getState().take();
    if (question) void submit(question);
  }, [pending, submit]);

  return (
    <div className="chat">
      <SessionList />

      <div className="chat__log">
        {turns.length === 0 && tools.length === 0 ? (
          <Welcome onPick={setDraft} />
        ) : (
          turns.map((turn, i) => (
            <div key={i} className="turn" data-role={turn.role}>
              <span className="turn__who">{turn.role === "user" ? "you" : "jky"}</span>
              <div className="turn__text">{turn.text}</div>
            </div>
          ))
        )}

        {tools.map((req) => (
          <ToolCard
            key={req.id}
            request={req}
            onApprove={(id) => {
              useChat.getState().clearTool(id);
              void getPlatform()
                .ai.approveTool(id)
                .catch((e) => useChat.getState().setError(describeError(e)));
            }}
            onReject={(id) => {
              useChat.getState().clearTool(id);
              void getPlatform()
                .ai.rejectTool(id)
                .catch((e) => useChat.getState().setError(describeError(e)));
            }}
          />
        ))}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="chat__compose"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        <input
          className="input"
          aria-label="Message"
          placeholder="Ask about this project…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
