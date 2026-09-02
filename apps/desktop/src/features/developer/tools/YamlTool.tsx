import { useState } from "react";
import { getPlatform } from "../../../platform";
import { ToolFrame, ToolInput, ToolOutput } from "./Shared";
import { Examples, WhatFor } from "./Examples";

type Action = "toJson" | "toYaml";

const LABELS: Record<Action, string> = {
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
      // Both directions read the input with the YAML parser, because YAML is
      // a superset of JSON and so it reads both. The alternative was a
      // separate JSON-only path, which meant "To YAML" refused the YAML in
      // the box — a button that only worked if you had already converted the
      // thing you were asking it to convert.
      const result =
        action === "toJson" ? await tools.yamlToJson(text) : await tools.formatYaml(text);
      setOut(result);
    } catch (e) {
      setOut("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolFrame hint="Reads the document, then writes it back — so the output is what the input meant. Paste YAML or JSON; both buttons take either.">
      <WhatFor>
        <p>
          Tidy a YAML file, or turn it into JSON and back — reading it through
          the parser, so what comes out is what the file <em>means</em>.
        </p>
        <p>
          Reach for it when a config is not doing what it looks like it should.
          YAML has opinions about indentation and about the word <code>no</code>,
          and seeing the same document as JSON is the quickest way to find out
          what it actually says.
        </p>
      </WhatFor>

      <Examples
        examples={[
          {
            label: "A service config",
            shows: "the same file as JSON, keys and all",
            load: () =>
              setText(
                "name: web\nreplicas: 3\nports:\n  - 8080\n  - 8443\nenv:\n  DEBUG: false\n  REGION: eu-west-1\n",
              ),
            },
          {
            label: "The Norway problem",
            shows: "why `country: NO` is not the string you expected",
            load: () => setText("country: NO\nenabled: yes\nversion: 1.10\n"),
          },
          {
            label: "Some JSON",
            shows: "the same data as YAML — the buttons take either format",
            load: () =>
              setText('{"name":"web","replicas":3,"ports":[8080,8443],"env":{"DEBUG":false}}'),
          },
          {
            label: "Broken indentation",
            shows: "the parse error, with the line it stopped on",
            load: () => setText("services:\n  web:\n    ports: [80\n  db:\n"),
          },
        ]}
      />

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
        <span className="tl__note">Either button takes either format.</span>
      </div>

      <ToolOutput label="Result" text={out} error={error} />
    </ToolFrame>
  );
}
