import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform, type AiMessage, type ToolRequest } from "../../platform";
import { ToolCard } from "./ToolCard";
import "./Assistant.css";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolRequest[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const platform = getPlatform();
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    void (async () => {
      const subs = await Promise.all([
        platform.ai.onDelta((text) =>
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            // Append to the open assistant turn rather than starting a new
            // one per token, or the log becomes one turn per character.
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, text: last.text + text }];
            }
            return [...prev, { role: "assistant", text }];
          }),
        ),
        platform.ai.onToolRequest((req) => setTools((t) => [...t, req])),
        platform.ai.onDone(() => setBusy(false)),
        platform.ai.onError((message) => {
          setError(message);
          setBusy(false);
        }),
      ]);

      if (cancelled) {
        subs.forEach((fn) => fn());
        return;
      }
      cleanups.push(...subs);
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, tools]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;

    setTurns((prev) => [...prev, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    setError(null);

    const conversation: AiMessage[] = [{ role: "user", content: [{ type: "text", text }] }];

    try {
      await getPlatform().ai.send("openai", conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
      setBusy(false);
    }
  }, [draft]);

  return (
    <div className="chat">
      <div className="chat__log">
        {turns.length === 0 && (
          <p className="chat__empty">
            Ask about this project. The assistant can read your files and propose
            commands, but nothing runs until you approve it.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="turn" data-role={turn.role}>
            <span className="turn__who">{turn.role === "user" ? "you" : "jky"}</span>
            <div className="turn__text">{turn.text}</div>
          </div>
        ))}

        {tools.map((req) => (
          <ToolCard
            key={req.id}
            request={req}
            onApprove={(id) => {
              void getPlatform().ai.approveTool(id);
              setTools((t) => t.filter((x) => x.id !== id));
            }}
            onReject={(id) => {
              void getPlatform().ai.rejectTool(id);
              setTools((t) => t.filter((x) => x.id !== id));
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
          void send();
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
