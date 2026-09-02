import { useState } from "react";
import { getPlatform } from "../../../platform";
import { ToolFrame, ToolInput, ToolOutput } from "./Shared";

type Action = "tidy" | "toJson" | "toYaml";

const LABELS: Record<Action, string> = {
  tidy: "Tidy",
  toJson: "To JSON",
  toYaml: "To YAML",
};

/**
 * The YAML tool.
 *
 * On a button rather than as you type, unlike JSON: this one crosses to Rust,
 * and reparsing a document on every keystroke would be a round trip per
 * character for an answer nobody asked for yet.
 *
 * Everything goes through the parser rather than being rewritten as text, so
 * what comes out is what the input *meant*. A file that looks tidy and parses
 * to something surprising is exactly the file someone opens a tool to
 * understand.
 */
export function YamlTool() {
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const tools = getPlatform().tools;
      const result =
        action === "tidy"
          ? await tools.formatYaml(text)
          : action === "toJson"
            ? await tools.yamlToJson(text)
            : await tools.jsonToYaml(text);
      setOut(result);
    } catch (e) {
      setOut("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolFrame hint="Reads the document, then writes it back — so the output is what the input meant.">
      <ToolInput label="YAML" value={text} onChange={setText} placeholder={"name: jky\nport: 8080"} />

      <div className="tl__row">
        {(Object.keys(LABELS) as Action[]).map((action) => (
          <button
            key={action}
            type="button"
            className="tool"
            disabled={busy || text.trim() === ""}
            onClick={() => void apply(action)}
          >
            {LABELS[action]}
          </button>
        ))}
        <span className="tl__note">To YAML takes JSON in.</span>
      </div>

      <ToolOutput label="Result" text={out} error={error} />
    </ToolFrame>
  );
}
