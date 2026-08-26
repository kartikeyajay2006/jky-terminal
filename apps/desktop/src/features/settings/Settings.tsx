import { useCallback, useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { THEMES, applyTheme, loadTheme, saveTheme, type ThemeId } from "../../app/theme";
import { getPlatform, type AuditEvent, type CommandSpec } from "../../platform";
import { ProviderVault } from "./ProviderVault";
import "./Settings.css";

type Panel = "appearance" | "providers" | "commands" | "activity";

const PANELS: Array<{ id: Panel; label: string; blurb: string }> = [
  { id: "appearance", label: "Appearance", blurb: "Theme and how the app looks" },
  { id: "providers", label: "Providers", blurb: "API keys and model selection" },
  { id: "commands", label: "Commands", blurb: "What you can type in a terminal" },
  { id: "activity", label: "Activity", blurb: "Every key read, tool call and command" },
];

export function Settings() {
  const [panel, setPanel] = useState<Panel>("appearance");
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

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
          <section className="settings__section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading">Appearance</h2>

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
        ) : panel === "activity" ? (
          <ActivityLog />
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
    <section className="settings__section" aria-labelledby="commands-heading">
      <h2 id="commands-heading">Commands</h2>
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

/** How an audit entry's kind reads to a person rather than to a serialiser. */
const KIND_LABEL: Record<string, string> = {
  SecretRead: "key read",
  ToolCall: "tool call",
  CommandRun: "command run",
  CommandRejected: "command declined",
  ProviderRequest: "request sent",
};

function ActivityLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void getPlatform()
      .readAudit()
      .then((all) => {
        // Newest first: what just happened is what you came to look at.
        setEvents([...all].reverse());
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="settings__section" aria-labelledby="activity-heading">
      <div className="activity__head">
        <h2 id="activity-heading">Activity</h2>
        <button type="button" className="btn" onClick={load}>
          Refresh
        </button>
      </div>

      <p className="hint">
        Every time your key is read, a tool runs, or a command is approved or
        declined, it is recorded here. The file lives beside your settings and
        can be read without this app.
      </p>

      {failed && (
        <p className="alert" role="alert">
          Could not read the activity log.
        </p>
      )}

      {!failed && events.length === 0 && (
        <p className="hint">Nothing recorded yet.</p>
      )}

      <ul className="activity" aria-label="Recorded activity">
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className="activity__row" data-kind={event.kind}>
            <span className="activity__when">{event.at.replace("T", " ").replace("Z", "")}</span>
            <span className="activity__kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
            <span className="activity__detail">{event.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
