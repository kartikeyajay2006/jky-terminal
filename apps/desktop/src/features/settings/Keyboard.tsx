import { useEffect, useMemo, useRef, useState } from "react";
import { useKeymap } from "../../app/keymapStore";
import { chordOf } from "../../platform/keymap";
import { PanelHead } from "./PanelHead";

/**
 * Every shortcut, and what it is bound to.
 *
 * A binding is captured by pressing it rather than typed. Typing `Ctrl+Shift+D`
 * into a box means agreeing with the app about how a chord is spelled, and
 * getting it wrong produces a shortcut that reads correctly and never fires —
 * which is the one failure a settings panel must not be able to cause.
 */
export function Keyboard() {
  const bindings = useKeymap((s) => s.bindings);
  const conflicts = useKeymap((s) => s.conflicts);
  const error = useKeymap((s) => s.error);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const groups = useMemo(() => {
    const out = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      out.set(binding.group, [...(out.get(binding.group) ?? []), binding]);
    }
    return [...out.entries()];
  }, [bindings]);

  const changed = bindings.filter((b) => b.custom).length;

  return (
    <section aria-labelledby="keyboard-heading">
      <PanelHead
        where="Keyboard"
        headingId="keyboard-heading"
        status={changed === 0 ? "all default" : `${changed} changed`}
      />

      <p className="settings__blurb">
        Choose a shortcut and press the keys you want. Every binding needs
        Ctrl, Cmd or Alt — an unmodified key belongs to the shell, where every
        keystroke means something.
      </p>

      {error && (
        <p className="settings__note" role="status">
          The saved keymap could not be read, so these are the defaults. {error}
        </p>
      )}

      {conflicts.length > 0 && (
        <p className="settings__note" role="alert">
          {conflicts
            .map((c) => `${c.chord} runs both ${c.actions.join(" and ")}`)
            .join("; ")}
          . Only the first will fire.
        </p>
      )}

      {refused && (
        <p className="settings__note" role="alert">
          {refused}
        </p>
      )}

      {groups.map(([group, rows]) => (
        <div key={group} className="keys__group">
          <h3 className="keys__group-name">{group}</h3>
          <ul className="keys__list">
            {rows.map((binding) => (
              <li key={binding.action} className="keys__row">
                <span className="keys__label">{binding.label}</span>
                <Capture
                  action={binding.action}
                  chord={binding.chord}
                  label={binding.label}
                  capturing={capturing === binding.action}
                  onStart={() => {
                    setRefused(null);
                    setCapturing(binding.action);
                  }}
                  onStop={() => setCapturing(null)}
                  onRefused={setRefused}
                />
                {binding.custom && (
                  <button
                    type="button"
                    className="keys__reset"
                    onClick={() => void useKeymap.getState().reset(binding.action)}
                  >
                    Reset
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button
        type="button"
        className="keys__reset-all"
        disabled={changed === 0}
        onClick={() => {
          setRefused(null);
          void useKeymap.getState().resetAll();
        }}
      >
        Reset every shortcut
      </button>
    </section>
  );
}

interface CaptureProps {
  action: string;
  chord: string;
  label: string;
  capturing: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefused: (message: string) => void;
}

/**
 * One shortcut, listening.
 *
 * While capturing it swallows everything: a settings panel that let Ctrl+W
 * through would close the tab it is sitting in the moment somebody tried to
 * rebind it. Escape leaves without changing anything, which has to be a key
 * rather than a button — the mouse is across the room by then.
 */
function Capture({ action, chord, label, capturing, onStart, onStop, onRefused }: CaptureProps) {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;

    function onKeyDown(e: KeyboardEvent) {
      // Nothing reaches the app while a chord is being taken, including the
      // shortcut being replaced.
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onStop();
        return;
      }

      // A modifier held on its own is on its way to a chord, not a chord.
      const pressed = chordOf(e);
      if (!pressed) return;

      onStop();
      void useKeymap
        .getState()
        .bind(action, pressed)
        .catch((err: unknown) => onRefused(err instanceof Error ? err.message : String(err)));
    }

    // Capture phase, so this runs before the window listeners that would
    // otherwise act on the keystroke as well.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, action, onStop, onRefused]);

  // Leaving the button by any route ends the capture, or a panel scrolled
  // away would keep eating keys.
  useEffect(() => {
    if (capturing) button.current?.focus();
  }, [capturing]);

  return (
    <button
      ref={button}
      type="button"
      className="keys__chord"
      data-capturing={capturing ? "true" : undefined}
      aria-label={capturing ? `Press the new shortcut for ${label}` : `${label}: ${chord}. Change`}
      onClick={() => (capturing ? onStop() : onStart())}
      onBlur={() => capturing && onStop()}
    >
      {capturing ? "press keys…" : chord}
    </button>
  );
}
