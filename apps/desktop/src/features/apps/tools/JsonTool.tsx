import { useMemo, useState } from "react";
import { ToolFrame, ToolInput, ToolOutput } from "./Shared";
import { describeJson, formatJson, minifyJson } from "./json";

/**
 * The JSON tool.
 *
 * Reformats as you type rather than on a button, because the answer to "is
 * this valid" should not need asking. The error carries a line and column —
 * see `json.ts` for how, since the engine will not reliably say.
 */
export function JsonTool() {
  const [text, setText] = useState("");
  const [minified, setMinified] = useState(false);

  const result = useMemo(
    () => (minified ? minifyJson(text) : formatJson(text, 2)),
    [text, minified],
  );
  const shape = useMemo(() => describeJson(text), [text]);

  return (
    <ToolFrame hint="Formats as you type. Nothing leaves this window.">
      <ToolInput label="JSON" value={text} onChange={setText} placeholder='{"hello": "world"}' />

      <div className="tl__row">
        <button
          type="button"
          className="tool"
          aria-pressed={!minified}
          onClick={() => setMinified(false)}
        >
          Format
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={minified}
          onClick={() => setMinified(true)}
        >
          Minify
        </button>
        {shape && (
          <span className="tl__note">
            {shape.keys} keys · {shape.arrays} arrays · depth {shape.depth}
          </span>
        )}
      </div>

      {/* Said where the answer is, because it is a warning about the answer:
          JSON.parse rounds anything past 2^53, so the output below holds a
          different number from the one that went in. */}
      {result.ok && result.lostPrecision && (
        <p className="tl__warn">
          A number here is too large for JavaScript to hold exactly, so the output has rounded
          it. Do not paste this back over the original.
        </p>
      )}

      <ToolOutput
        label="Result"
        text={result.ok ? result.text : ""}
        error={result.ok ? null : `Line ${result.line}, column ${result.column} — ${result.message}`}
      />
    </ToolFrame>
  );
}
