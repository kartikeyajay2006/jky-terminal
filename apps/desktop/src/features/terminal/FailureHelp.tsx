import { useCallback, useEffect, useState } from "react";
import { getPlatform } from "../../platform";
import type { ProviderStatus } from "../../platform/types";
import {
  HELP_KINDS,
  helpRequest,
  usableProviders,
  type CommandFailure,
  type HelpKind,
} from "./commandFailure";

/**
 * What appears under a command that failed.
 *
 * The offer is free. It is drawn entirely from what the terminal already
 * knows — the command, the exit code, the output on screen — and appears
 * under every failure, which it could not do if appearing cost anything.
 * Nothing reaches a model until one of the buttons is pressed, and a test
 * pins that.
 *
 * With nothing configured it says so once rather than offering four buttons
 * that all fail the same way. "Nothing configured" means no key *and* no
 * local runtime: Ollama needs no credential, so an empty vault is not the
 * same question as nothing to ask.
 */
export function FailureHelp({
  failure,
  recentOutput,
  onDismiss,
}: {
  failure: CommandFailure;
  /** The tail of what this terminal has on screen. Called only when asked. */
  recentOutput: () => string;
  onDismiss: () => void;
}) {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState<HelpKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getPlatform()
      .vault.listProviders()
      .then((all) => {
        if (live) setProviders(all);
      })
      .catch(() => {
        if (live) setProviders([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const usable = providers ? usableProviders(providers) : [];
  const canAsk = usable.length > 0;

  const ask = useCallback(
    (kind: HelpKind) => {
      // One question at a time. Asking again while an answer is coming spends
      // twice for one answer.
      if (asking !== null || !canAsk) return;

      const chosen = usable[0];
      setAsking(kind);
      setError(null);
      setAnswer(null);

      // The output is read here rather than held since the failure, so a
      // request that is never made never copies the screen.
      const request = helpRequest(kind, failure, recentOutput());

      void getPlatform()
        .ai.askOnce(chosen.id, request.text)
        .then(setAnswer)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setAsking(null));
    },
    [asking, canAsk, usable, failure, recentOutput],
  );

  // The numbers beside each choice, and Escape, because the panel shows them
  // and a terminal is a keyboard before it is anything else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "4") {
        e.preventDefault();
        onDismiss();
        return;
      }
      const chosen = HELP_KINDS.find((k) => k.key === e.key);
      if (chosen && canAsk) {
        e.preventDefault();
        ask(chosen.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, canAsk, onDismiss]);

  return (
    <div className="fail" role="group" aria-label="Command failed">
      <div className="fail__head">
        <span className="fail__glyph" aria-hidden="true">
          ▲
        </span>
        <code className="fail__command">{failure.command || "the last command"}</code>
        <span className="fail__code">exit {failure.code}</span>
      </div>

      {providers === null ? (
        <p className="fail__quiet">…</p>
      ) : canAsk ? (
        <>
          <p className="fail__lede">
            <span className="fail__badge">AI</span> Ask about this — nothing is sent until you
            choose.
          </p>
          <div className="fail__choices">
            {HELP_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className="fail__choice"
                disabled={asking !== null}
                onClick={() => ask(kind.id)}
              >
                <span className="fail__key" aria-hidden="true">
                  {kind.key}
                </span>
                {kind.label}
              </button>
            ))}
            <button type="button" className="fail__choice fail__choice--quiet" onClick={onDismiss}>
              <span className="fail__key" aria-hidden="true">
                4
              </span>
              Ignore
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="fail__lede">
            Add an API key in Settings, or run Ollama on this machine, and suggestions appear
            here when something fails.
          </p>
          <div className="fail__choices">
            <button type="button" className="fail__choice fail__choice--quiet" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </>
      )}

      {asking !== null && <p className="fail__quiet">Thinking…</p>}

      {error && (
        <p className="fail__error" role="alert">
          {error}
        </p>
      )}

      {/* A `pre`, because the answer is often a command and its whitespace is
          the difference between one that runs and one that does not. */}
      {answer && <pre className="fail__answer">{answer}</pre>}
    </div>
  );
}
