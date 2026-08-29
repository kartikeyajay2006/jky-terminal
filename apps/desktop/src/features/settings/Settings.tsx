import { useEffect, useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { THEMES, applyTheme, loadTheme, saveTheme, type ThemeId } from "../../app/theme";
import { getPlatform, type CommandSpec } from "../../platform";
import { useNav } from "../../app/navStore";
import {
  MAX_SIZE,
  MIN_SIZE,
  TERM_FONTS,
  announceTermFont,
  loadTermFont,
  saveTermFont,
  isFontAvailable,
  primaryFace,
  stackFor,
  type TermFont,
} from "../terminal/termFont";
import { PanelHead } from "./PanelHead";
import { ProviderVault } from "./ProviderVault";
import "./Settings.css";

type Panel = "appearance" | "terminal" | "providers" | "commands";

const PANELS: Array<{ id: Panel; label: string; blurb: string }> = [
  { id: "appearance", label: "Appearance", blurb: "Theme and how the app looks" },
  { id: "terminal", label: "Terminal", blurb: "Font size and typeface" },
  { id: "providers", label: "Providers", blurb: "API keys and model selection" },
  { id: "commands", label: "Commands", blurb: "What you can type in a terminal" },
];

export function Settings() {
  const [panel, setPanel] = useState<Panel>("appearance");
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  // The palette asks for a panel by leaving it on the nav store.
  const pendingNav = useNav((s) => s.pending);
  useEffect(() => {
    const wanted = useNav.getState().takePanel("settings");
    if (wanted && PANELS.some((p) => p.id === wanted)) setPanel(wanted as Panel);
  }, [pendingNav]);

  function changeTheme(id: ThemeId) {
    setTheme(id);
    applyTheme(id);
    saveTheme(id);
  }

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings sections">
        <h1 className="settings__title">Settings</h1>
        <ul>
          {PANELS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="settings__link"
                aria-current={panel === p.id ? "page" : undefined}
                onClick={() => setPanel(p.id)}
              >
                <span className="settings__link-label">{p.label}</span>
                <span className="settings__link-blurb">{p.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="settings__panel">
        {panel === "appearance" ? (
          <section className="panel" aria-labelledby="appearance-heading">
            <PanelHead
              where="Appearance"
              headingId="appearance-heading"
              status={
                <>
                  <b>{THEMES.length}</b> themes
                </>
              }
            />

            <div className="field">
              <span className="field__label" id="theme-label">
                Theme
              </span>
              <Select
                label="Theme"
                value={theme}
                options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
                onChange={(id) => changeTheme(id as ThemeId)}
              />
              <p className="hint">
                The last theme targets WCAG AAA contrast and is the one to reach
                for if the others are hard to read.
              </p>
            </div>

            {/* A palette is easier to recognise than to read about. These are
                buttons, not list items: role="listitem" would strip the
                button semantics and leave them with no accessible name. */}
            <div className="swatches" role="group" aria-label="Theme previews">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="swatch"
                  aria-pressed={theme === t.id}
                  onClick={() => changeTheme(t.id)}
                >
                  <span className="swatch__chip" style={{ background: t.swatch }} aria-hidden="true" />
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        ) : panel === "terminal" ? (
          <TerminalSettings />
        ) : panel === "commands" ? (
          <CommandList />
        ) : (
          <ProviderVault />
        )}
      </div>
    </div>
  );
}

/**
 * How the terminal is set.
 *
 * Applied the instant it changes rather than behind a Save: a font size is
 * something you judge by looking at it, and a preview you have to commit to
 * before seeing is not a preview.
 */
function TerminalSettings() {
  const [font, setFont] = useState<TermFont>(loadTermFont);

  // Measured once. Which faces a machine has does not change while a settings
  // panel is open, and measuring is a canvas draw per candidate.
  const installed = useMemo(() => {
    const out = new Map<string, boolean | null>();
    for (const f of TERM_FONTS) {
      out.set(f.id, f.stack ? isFontAvailable(primaryFace(f.stack)) : null);
    }
    return out;
  }, []);

  /**
   * Only the faces this machine actually has.
   *
   * Offering one it does not have is offering a setting that does nothing:
   * choosing it falls back to whatever was already on screen, which reads as
   * a bug rather than as a missing font. The current choice stays in the list
   * even if it is missing — a saved setting from another machine should not
   * leave the control showing a blank — and anything we could not measure is
   * kept, because "unknown" is not "absent".
   */
  const offered = useMemo(
    () =>
      TERM_FONTS.filter(
        (f) => installed.get(f.id) !== false || f.id === font.family,
      ),
    [installed, font.family],
  );

  function change(next: TermFont) {
    const saved = saveTermFont(next);
    setFont(saved);
    // Every open terminal hears this and refits itself.
    announceTermFont(saved);
  }

  const choice = TERM_FONTS.find((f) => f.id === font.family) ?? TERM_FONTS[0];

  return (
    <section className="panel" aria-labelledby="terminal-heading">
      <PanelHead
        where="Terminal"
        headingId="terminal-heading"
        status={
          <>
            <b>{font.size}</b> pt · <b>{offered.length}</b> faces
          </>
        }
      />

      <div className="field">
        <span className="field__label">Font size</span>
        <div className="fontsize">
          <button
            type="button"
            className="fontsize__step"
            aria-label="Smaller"
            disabled={font.size <= MIN_SIZE}
            onClick={() => change({ ...font, size: font.size - 1 })}
          >
            −
          </button>

          <input
            className="fontsize__range"
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            value={font.size}
            aria-label="Terminal font size"
            onChange={(e) => change({ ...font, size: Number(e.target.value) })}
          />

          <button
            type="button"
            className="fontsize__step"
            aria-label="Larger"
            disabled={font.size >= MAX_SIZE}
            onClick={() => change({ ...font, size: font.size + 1 })}
          >
            +
          </button>

          <output className="fontsize__value">{font.size}pt</output>
        </div>
        <p className="hint">
          Below {MIN_SIZE}pt box-drawing characters stop lining up and something
          like <code>htop</code> becomes unreadable. Above {MAX_SIZE}pt an
          eighty-column program no longer fits the pane.
        </p>
      </div>

      <div className="field">
        <span className="field__label">Typeface</span>
        <Select
          label="Terminal typeface"
          value={font.family}
          options={offered.map((f) => ({
            value: f.id,
            // Only reachable for a choice carried over from another machine,
            // which is kept listed so the control is not left blank.
            label:
              installed.get(f.id) === false ? `${f.label}  (not installed)` : f.label,
          }))}
          onChange={(id) => change({ ...font, family: id })}
        />

        {installed.get(font.family) === false ? (
          <p className="hint hint--warn">
            <strong>{choice.label} is not on this machine</strong>, so the
            terminal is falling back to another monospace and will look
            unchanged. Install it, or pick one marked as available.
          </p>
        ) : (
          <p className="hint">
            {choice.note}. Only faces this machine actually has are listed —
            choosing one it does not have would fall back to another monospace
            and look like a setting that does nothing.
          </p>
        )}
      </div>

      <div className="field">
        <span className="field__label">
          Preview
          <span className="field__note">
            {font.family === "system"
              ? `resolves to ${primaryFace(stackFor("system"))}`
              : installed.get(font.family) === false
                ? "falling back — this is not the face you chose"
                : `showing ${choice.label}`}
          </span>
        </span>
        <pre
          className="fontpreview"
          style={{ fontFamily: stackFor(font.family), fontSize: `${font.size}px` }}
          aria-label="Font preview"
        >
{`[you@machine]~% ls -la
drwxr-xr-x  1 you  staff   4096 Aug 30 12:04 .
-rw-r--r--  1 you  staff  12480 Aug 30 11:58 README.md
┌────────────┬───────────┐
│ 0123456789 │ Il1 O0 rn │
└────────────┴───────────┘
if (x >= 1 && y !== 2) { /* -> */ }`}
        </pre>
      </div>
    </section>
  );
}

function CommandList() {
  const [commands, setCommands] = useState<CommandSpec[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getPlatform()
      .listCommands()
      .then(setCommands)
      .catch(() => setFailed(true));
  }, []);

  return (
    <section className="panel" aria-labelledby="commands-heading">
      <PanelHead
        where="Commands"
        headingId="commands-heading"
        status={
          <>
            <b>{commands.length}</b> commands
          </>
        }
      />
      <p className="hint">
        These work in any JKY Terminal tab. Typing <code>jky commands</code>
        prints the same list without leaving the terminal.
      </p>

      {failed && (
        <p className="alert" role="alert">
          Could not read the command list from the backend.
        </p>
      )}

      {/* A <ul> rather than a <dl>: a definition list carries no implicit
          ARIA role, so a screen reader announces neither that this is a list
          nor how many items it has. */}
      <ul className="cmds" aria-label="JKY commands">
        {commands.map((cmd) => (
          <li key={cmd.usage} className="cmds__row">
            <p className="cmds__head">
              <code className="cmds__usage">{cmd.usage}</code>
              {cmd.names.length > 1 && (
                <span className="cmds__aliases">
                  also {cmd.names.slice(1).join(", ")}
                </span>
              )}
            </p>
            <p className="cmds__body">
              <strong className="cmds__summary">{cmd.summary}</strong>
              <span className="cmds__detail">{cmd.detail}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
