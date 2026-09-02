import { useCallback, useEffect, useState } from "react";
import { useNav } from "../../app/navStore";
import { DiffTool } from "./tools/DiffTool";
import { HashTool } from "./tools/HashTool";
import { JsonTool } from "./tools/JsonTool";
import { JwtTool } from "./tools/JwtTool";
import { RegexTool } from "./tools/RegexTool";
import { YamlTool } from "./tools/YamlTool";
import { TOOLS, findTool } from "./registry";
import "./Developer.css";

const STORAGE_KEY = "jky.developer.tool";

/**
 * The body of one tool.
 *
 * A switch rather than a component on the registry record, for the reason the
 * app registry gives: the registry is plain data read by tests and by the
 * palette, and React components in it would make it un-shareable for the sake
 * of saving this.
 */
function body(id: string) {
  switch (id) {
    case "json":
      return <JsonTool />;
    case "yaml":
      return <YamlTool />;
    case "diff":
      return <DiffTool />;
    case "hash":
      return <HashTool />;
    case "jwt":
      return <JwtTool />;
    case "regex":
      return <RegexTool />;
    default:
      return null;
  }
}

/** The tool showing when this last closed, if it still exists. */
function remembered(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const id: unknown = JSON.parse(raw);
      if (typeof id === "string" && findTool(id)) return id;
    }
  } catch {
    // Unreadable storage, or a stored id from a version that had a tool this
    // one does not. Either way, start at the beginning.
  }
  return TOOLS[0].id;
}

/**
 * The Developer Tools section.
 *
 * A workbench, not a grid of apps. An app is a place you go and stay, and it
 * earns a tab; a tool is something you reach for, use and leave, usually in
 * the middle of doing something else. So this is the shape the Dashboard and
 * Settings already use — a list down the side, the chosen thing beside it —
 * where switching is instant and there is nothing to manage.
 *
 * Which tool you were in is remembered. A workbench that resets to the first
 * drawer every time you glance away is one you stop using for anything that
 * takes two visits.
 */
export function Developer() {
  const [current, setCurrent] = useState(remembered);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Preference lost; the tools still work.
    }
  }, [current]);

  // The palette can ask for a named tool. The request is left in the store
  // for this section to take, so which one was wanted survives the switch.
  const pending = useNav((s) => s.pending);
  const open = useCallback((id: string) => {
    if (findTool(id)) setCurrent(id);
  }, []);

  useEffect(() => {
    const wanted = useNav.getState().takePanel("developer");
    if (wanted) open(wanted);
  }, [pending, open]);

  const tool = findTool(current) ?? TOOLS[0];

  return (
    <div className="dev">
      <nav className="dev__nav" aria-label="Tools">
        <p className="dev__title">Developer Tools</p>
        <ul>
          {TOOLS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="dev__link"
                data-tone={entry.tone}
                data-backend={entry.backend}
                aria-current={entry.id === tool.id ? "page" : undefined}
                onClick={() => setCurrent(entry.id)}
              >
                <span className="dev__glyph" aria-hidden="true">
                  {entry.glyph}
                </span>
                <span className="dev__name">{entry.name}</span>
                {/* Says where the work happens, which is what explains a
                    round trip when one of these pauses. */}
                {entry.backend === "rust" && (
                  <span className="dev__where" aria-hidden="true">
                    rs
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <p className="dev__note">
          Nothing here needs an account, a key or a network. Everything is a
          function of what you paste into it.
        </p>
      </nav>

      <div className="dev__panel" data-tone={tool.tone}>
        <header className="dev__head">
          <p className="dev__eyebrow">Developer Tools</p>
          <h1 className="dev__heading">
            <span className="dev__heading-glyph" aria-hidden="true">
              {tool.glyph}
            </span>
            {tool.name}
          </h1>
          <p className="dev__blurb">{tool.blurb}</p>
        </header>

        {body(tool.id)}
      </div>
    </div>
  );
}
