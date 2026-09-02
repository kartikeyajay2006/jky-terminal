import { useState } from "react";
import { getPlatform } from "../../../platform";
import type { Diff } from "../../../platform/types";
import { ToolFrame, ToolInput } from "./Shared";

/** The mark beside a line. Text, so it is not colour alone that carries it. */
const MARK: Record<string, string> = { added: "+", removed: "−", same: " " };

/**
 * The diff viewer.
 *
 * Both line numbers, side by side, because after the first change the two
 * files stop agreeing about what line anything is on — and going to look at
 * the line a diff names is the entire reason to read one.
 *
 * Added and removed are marked with a character as well as a colour. Colour
 * alone would not carry it for anyone who cannot see the difference, and this
 * is the one place in the app where two rows differ only in meaning.
 */
export function DiffTool() {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compare() {
    setBusy(true);
    setError(null);
    try {
      setDiff(await getPlatform().tools.diff(before, after));
    } catch (e) {
      setDiff(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolFrame hint="Compares line by line. A difference in trailing newlines alone is not shown.">
      <div className="tl__pair">
        <ToolInput label="Before" value={before} onChange={setBefore} />
        <ToolInput label="After" value={after} onChange={setAfter} />
      </div>

      <div className="tl__row">
        <button type="button" className="tool" disabled={busy} onClick={() => void compare()}>
          Compare
        </button>
        {diff && (
          <span className="tl__note">
            <span className="tl__count" data-kind="added">
              {diff.added} added
            </span>
            <span className="tl__count" data-kind="removed">
              {diff.removed} removed
            </span>
          </span>
        )}
      </div>

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {diff && (
        <table className="tl__diff" aria-label="Differences">
          <thead>
            <tr>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">
                <span className="tl__sr">Change</span>
              </th>
              <th scope="col">Line</th>
            </tr>
          </thead>
          <tbody>
            {diff.lines.map((line, i) => (
              <tr key={`${line.kind}-${i}`} data-kind={line.kind}>
                <td className="tl__gutter">{line.old ?? ""}</td>
                <td className="tl__gutter">{line.new ?? ""}</td>
                <td className="tl__mark">{MARK[line.kind] ?? " "}</td>
                <td className="tl__diff-text">{line.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ToolFrame>
  );
}
