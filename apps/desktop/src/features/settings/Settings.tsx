import { useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { THEMES, applyTheme, loadTheme, saveTheme, type ThemeId } from "../../app/theme";
import { getPlatform, type CommandSpec } from "../../platform";
import { useNav } from "../../app/navStore";
import { PanelHead } from "./PanelHead";
import { ProviderVault } from "./ProviderVault";
import "./Settings.css";

type Panel = "appearance" | "providers" | "commands";

const PANELS: Array<{ id: Panel; label: string; blurb: string }> = [
  { id: "appearance", label: "Appearance", blurb: "Theme and how the app looks" },
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
        ) : panel === "commands" ? (
          <CommandList />
        ) : (
          <ProviderVault />
        )}
      </div>
    </div>
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
