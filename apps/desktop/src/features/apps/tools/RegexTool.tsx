import { useEffect, useState } from "react";
import { ToolFrame, ToolInput } from "./Shared";
import { FLAGS } from "./regexEngine";
import { useRegex } from "./useRegex";

/**
 * The regex tester.
 *
 * Runs in a worker, which is what stops a runaway pattern taking the window
 * with it — see `useRegex`. The panel says so, because "why did that stop" is
 * a fair question and "it was backtracking" is a useful answer.
 */
export function RegexTool({ makeWorker }: { makeWorker?: () => Worker }) {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("");
  const { result, busy, run } = useRegex(makeWorker);

  // Re-run on every change. The worker makes that safe: the cost of a bad
  // pattern is a thread, not the interface.
  useEffect(() => {
    run(pattern, flags, text);
  }, [pattern, flags, text, run]);

  const toggle = (flag: string) =>
    setFlags((current) =>
      current.includes(flag) ? current.replace(flag, "") : current + flag,
    );

  return (
    <ToolFrame hint="Runs off the main thread, so a pattern that will not finish is stopped rather than freezing the window.">
      <ToolInput label="Pattern" value={pattern} onChange={setPattern} rows={2} placeholder="\\b\\w+@\\w+\\.\\w+" />

      <div className="tl__row" role="group" aria-label="Flags">
        {FLAGS.map(({ flag, label }) => (
          <label key={flag} className="tl__flag">
            <input
              type="checkbox"
              checked={flags.includes(flag)}
              aria-label={label}
              onChange={() => toggle(flag)}
            />
            <code>{flag}</code>
            <span className="tl__flag-label">{label}</span>
          </label>
        ))}
      </div>

      <ToolInput label="Text" value={text} onChange={setText} placeholder="Text to search…" />

      {result && !result.ok && (
        <p className="tl__error" role="alert">
          {result.message}
        </p>
      )}

      {result?.ok && (
        <div className="tl__field">
          <span className="tl__label">
            {result.matches.length === 0
              ? "No matches"
              : `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`}
            {result.truncated && " (stopped counting)"}
            {busy && " …"}
          </span>

          {result.matches.length > 0 && (
            <ol className="tl__matches">
              {result.matches.map((match, i) => (
                <li key={`${match.index}-${i}`} className="tl__match">
                  <span className="tl__match-at">{match.index}</span>
                  <code className="tl__match-text">{match.text}</code>
                  {match.groups.length > 0 && (
                    <span className="tl__match-groups">
                      {match.groups.map((group, g) => (
                        <code key={g}>{group ?? "—"}</code>
                      ))}
                    </span>
                  )}
                  {Object.entries(match.named).map(([name, value]) => (
                    <span key={name} className="tl__match-named">
                      {name}: <code>{value ?? "—"}</code>
                    </span>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </ToolFrame>
  );
}
