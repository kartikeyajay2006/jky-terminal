import { useEffect, useState } from "react";
import { getPlatform, type SummonView } from "../../platform";

type Os = "mac" | "windows" | "linux";

function os(): Os {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  return "linux";
}

/**
 * The shortcuts recommended on each platform — the same the installers offer.
 *
 * Chosen so none takes a key another program depends on: no lone Ctrl, and
 * on macOS nothing on Cmd that apps already use.
 */
export const PRESETS: Record<Os, string[]> = {
  linux: ["Super+J", "Ctrl+Alt+J", "Ctrl+Alt+Space"],
  windows: ["Ctrl+Alt+J", "Super+J", "Ctrl+Alt+Space"],
  mac: ["Ctrl+Alt+J", "Ctrl+Alt+Space", "Shift+Super+J"],
};

/**
 * The shortcut that summons JKY from anywhere.
 *
 * Typed rather than pressed, unlike the bindings above it: the keys most
 * worth using here — Super, Cmd — are exactly the ones the desktop takes
 * before a window ever sees them.
 */
export function Summon() {
  const [view, setView] = useState<SummonView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const presets = PRESETS[os()];

  useEffect(() => {
    void getPlatform()
      .settings.summon()
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function choose(shortcut: string) {
    try {
      setView(await getPlatform().settings.setSummon(shortcut));
      setError(null);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const said = !view
    ? "Reading…"
    : !view.shortcut
      ? "No summon shortcut. Choose one to bring JKY forward from any app."
      : view.active
        ? "Press it from any app to bring JKY forward."
        : (view.note ?? "Saved, but not held by this running JKY.");

  return (
    <div className="summon" aria-labelledby="summon-heading">
      <h3 id="summon-heading" className="summon__title">
        Summon JKY from anywhere
      </h3>
      <p className="summon__now">
        {view?.shortcut ? (
          <kbd className="summon__current" aria-label="Current summon shortcut">
            {view.shortcut}
          </kbd>
        ) : (
          <span className="summon__none">none</span>
        )}
        <span role="status" className={view?.shortcut && !view.active ? "summon__note summon__note--warn" : "summon__note"}>
          {said}
          {view?.shortcut && view.active && view.note ? ` ${view.note}` : ""}
        </span>
      </p>

      <form
        className="summon__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void choose(draft);
        }}
      >
        <input
          className="input"
          aria-label="Summon shortcut"
          placeholder={presets[0]}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
          Save
        </button>
        {view?.shortcut && (
          <button type="button" className="btn" onClick={() => void choose("none")}>
            Turn off
          </button>
        )}
      </form>

      <p className="summon__presets">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="summon__preset"
            aria-label={`Use ${preset}`}
            onClick={() => void choose(preset)}
          >
            <kbd>{preset}</kbd>
          </button>
        ))}
      </p>

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
