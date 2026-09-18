import { useCallback, useEffect, useRef, useState } from "react";
import { useAsk } from "../../app/askStore";
import { useChat } from "../../app/chatStore";
import { getPlatform, type AiMessage } from "../../platform";
import { describeError } from "./errors";
import { ConversationHeader } from "./ConversationHeader";
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
  const project = useChat((s) => s.project);
  const memory = sessions.find((s) => s.id === activeId)?.memory ?? "";

  // Workspace selection is the project boundary. The note stays in local
  // storage; it only joins an outgoing request after the user sends.
  useEffect(() => {
    void getPlatform()
      .workspaces.list()
      .then(({ workspaces, active }) => {
        const workspace = workspaces.find((item) => item.id === active);
        useChat.getState().setProject(workspace?.name ?? null);
      })
      .catch(() => useChat.getState().setProject(null));
  }, []);

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

      // The whole conversation, not just the new question. addTurn already
      // recorded it, so history() includes it — sending only the latest
      // question is what made every follow-up arrive with no context.
      const conversation: AiMessage[] = useChat.getState().history();

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
      <ConversationHeader />

      <div className="chat__log">
        {activeId && (
          <section className="chat__memory" aria-labelledby="project-memory-heading">
            <div>
              <h2 id="project-memory-heading">Local project context</h2>
              <p>{project ? `Stored with this conversation for ${project}.` : "Stored with this conversation on this device."}</p>
            </div>
            <textarea
              className="input"
              aria-label="Local project context"
              value={memory}
              maxLength={6000}
              placeholder="Goals, conventions, decisions, or constraints to remember…"
              onChange={(event) => useChat.getState().setMemory(event.target.value)}
            />
            <p>Never sent by itself. It is included only when you send this assistant a message.</p>
          </section>
        )}
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
        {busy ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              void getPlatform().ai.cancel();
              setBusy(false);
            }}
          >
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
