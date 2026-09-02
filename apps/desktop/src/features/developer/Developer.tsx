import { useCallback, useEffect, useState } from "react";
import { TileBoard } from "../../components/TileBoard";
import { TabStrip } from "../../components/TabStrip";
import {
  closeIn,
  loadSession,
  openIn,
  saveSession,
  showBoard,
  type Session,
} from "../../lib/boardSession";
import { useNav } from "../../app/navStore";
import type { GroupSpec } from "../../lib/tileLayout";
import { DiffTool } from "./tools/DiffTool";
import { HashTool } from "./tools/HashTool";
import { JsonTool } from "./tools/JsonTool";
import { JwtTool } from "./tools/JwtTool";
import { RegexTool } from "./tools/RegexTool";
import { YamlTool } from "./tools/YamlTool";
import { TOOLS, findTool, type ToolDef } from "./registry";
import "./Developer.css";

const SESSION_KEY = "jky.developer.session";

/** Where this board keeps its arrangement. Its own key, not the Apps one. */
export const DEV_KEY = "jky.developer.layout";

/**
 * Where a new tool lands.
 *
 * Split by where the work happens, because it is the one thing that changes
 * how a tool behaves: the ones in the window answer as you type, and the ones
 * in Rust wait for a button. Someone wondering why one of them pauses has the
 * answer above the tile.
 */
export const DEV_GROUPS: GroupSpec<ToolDef>[] = [
  { name: "Answer as you type", holds: (tool) => tool.backend === "window" },
  { name: "Run on a button", holds: (tool) => tool.backend === "rust" },
];

/**
 * The body of one tool.
 *
 * A switch rather than a component on the registry record, for the reason the
 * app registry gives: the registry is plain data read by tests, by the board
 * and by the palette, and React components in it would make it un-shareable
 * for the sake of saving this.
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

/**
 * The Developer Tools section.
 *
 * The same board as Apps, because the same things are true of it: you pick
 * one thing out of several, the tiles have to say what each one is for, and
 * you should be able to arrange them. Everything about the grid is shared —
 * see `TileBoard` — and what is here is which tools, how they are grouped,
 * and what happens when one is opened.
 *
 * Which tool you were in is remembered. A workbench that resets every time
 * you glance at the terminal is one you stop using for anything that takes
 * two visits.
 */
export function Developer() {
  const [session, setSession] = useState<Session>(() =>
    loadSession(SESSION_KEY, (id) => findTool(id) !== undefined),
  );

  useEffect(() => {
    saveSession(SESSION_KEY, session);
  }, [session]);

  const { open: openTools, active } = session;

  const open = useCallback((id: string) => {
    if (findTool(id)) setSession((s) => openIn(s, id));
  }, []);

  // The palette can ask for a named tool. The request is left in the store
  // for this section to take, so which one was wanted survives the switch.
  const pending = useNav((s) => s.pending);
  useEffect(() => {
    const wanted = useNav.getState().takePanel("developer");
    if (wanted) open(wanted);
  }, [pending, open]);

  const current = active ? findTool(active) : undefined;

  return (
    <div className="dev-shell">
      <TabStrip
        label="Open tools"
        tabs={openTools.flatMap((id) => {
          const tool = findTool(id);
          return tool ? [{ id, name: tool.name, glyph: tool.glyph, accent: tool.accent }] : [];
        })}
        activeId={active}
        onSelect={(id) => setSession((s) => ({ ...s, active: id }))}
        onClose={(id) => setSession((s) => closeIn(s, id))}
        onShowBoard={() => setSession(showBoard)}
        addLabel="Open another tool"
      />

      {!current && (
        <div className="dev">
          <TileBoard
            items={TOOLS.map((entry) => ({
              ...entry,
              accent: entry.accent,
              // Where the work happens, which is what explains a pause.
              badge: entry.backend === "rust" ? "runs in Rust" : undefined,
            }))}
            label="Developer Tools"
            groups={DEV_GROUPS}
            storageKey={DEV_KEY}
            openIds={openTools}
            onOpen={open}
            header={({ shown, hidden }) => (
              <>
                <p className="board__eyebrow">
                  <span>{shown} tools</span>
                  <span className="board__eyebrow-sep" aria-hidden="true">
                    ·
                  </span>
                  <span>no account, no key, no network</span>
                  {hidden > 0 && (
                    <>
                      <span className="board__eyebrow-sep" aria-hidden="true">
                        ·
                      </span>
                      <span>{hidden} hidden</span>
                    </>
                  )}
                </p>
                <h1 className="board__title">Developer Tools</h1>
                <p className="board__lede">
                  Everything here is a function of what you paste into it. Nothing is sent
                  anywhere, nothing is stored, and each one opens with a worked example you can
                  load and take apart.
                </p>
              </>
            )}
          />
        </div>
      )}

      {/* Every open tool stays mounted; only the active one is shown. Hiding
          rather than unmounting is the whole point of two being open — what
          you typed into one is still there when you come back to it. */}
      {openTools.map((id) => {
        const tool = findTool(id);
        if (!tool) return null;
        return (
          <div
            key={id}
            className="dev dev--open"
            hidden={active !== id}
            data-tone={tool.tone}
          >
            <header className="dev__bar">
              <button
                type="button"
                className="dev__back"
                onClick={() => setSession(showBoard)}
              >
                <span aria-hidden="true">←</span> All tools
              </button>
              <h1 className="dev__heading">
                <span className="dev__heading-glyph" aria-hidden="true">
                  {tool.glyph}
                </span>
                {tool.name}
              </h1>
              <p className="dev__blurb">{tool.blurb}</p>
            </header>

            <div className="dev__panel">{body(tool.id)}</div>
          </div>
        );
      })}
    </div>
  );
}
