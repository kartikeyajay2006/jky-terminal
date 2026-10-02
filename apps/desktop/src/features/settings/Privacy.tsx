import { useEffect, useState } from "react";
import { FolderPicker } from "../../components/FolderPicker";
import { Select } from "../../components/Select";
import { getPlatform, type Privacy, type PrivacyView } from "../../platform";
import { PanelHead } from "./PanelHead";

/** The retention windows worth offering, in days. 0 is "never forget". */
const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "0", label: "Never" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What the app keeps about what you do, and where the assistant may look.
 *
 * Every change is applied the moment it is made, and enforced in Rust rather
 * than here: history that is off is not written whatever the window sends,
 * and turning scrollback off deletes what was saved. This panel only asks.
 */
export function PrivacySettings() {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    getPlatform()
      .settings.privacy()
      .then(setView)
      .catch((cause) => setError(messageOf(cause)));
  }, []);

  async function apply(change: Partial<Privacy>) {
    if (!view) return;
    const next: Privacy = {
      keepHistory: view.keepHistory,
      historyDays: view.historyDays,
      keepScrollback: view.keepScrollback,
      ...change,
    };
    try {
      await getPlatform().settings.setPrivacy(next);
      setView({ ...view, ...next });
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function chooseFolder(dir: string) {
    try {
      await getPlatform().settings.setProjectDir(dir);
      setView((was) => (was ? { ...was, projectDir: dir.trim() || null } : was));
      setFolderError(null);
      setNotice(dir.trim() ? `Project folder set to ${dir.trim()}.` : "Project folder cleared.");
    } catch (cause) {
      setFolderError(messageOf(cause));
    }
  }

  async function clearHistory() {
    try {
      await getPlatform().history.clear();
      setConfirmingClear(false);
      setNotice("History cleared.");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <section className="panel" aria-labelledby="privacy-heading">
      <PanelHead where="Privacy" headingId="privacy-heading" />

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}

      {view && (
        <>
          <div className="field">
            <label className="privacy__toggle">
              <input
                type="checkbox"
                checked={view.keepHistory}
                onChange={(e) => void apply({ keepHistory: e.target.checked })}
              />
              <span>Keep command history</span>
            </label>
            <p className="hint">
              Every finished command, where it ran and how it ended, for History search. Secrets
              with a recognisable shape are redacted before anything is written. Turning this off
              stops recording; what is already kept stays until you clear it.
            </p>
          </div>

          <div className="field">
            <span className="field__label">Forget history older than</span>
            <Select
              label="Forget history older than"
              value={String(view.historyDays)}
              options={WINDOWS}
              disabled={!view.keepHistory}
              onChange={(days) => void apply({ historyDays: Number(days) })}
            />
            <p className="hint">Applied now, and again every time History is searched.</p>
          </div>

          <div className="field">
            {confirmingClear ? (
              <div className="privacy__confirm" role="group" aria-label="Confirm clearing history">
                <span>Every command in History will be forgotten. There is no undo.</span>
                <button type="button" className="btn btn--danger" onClick={() => void clearHistory()}>
                  Yes, clear it
                </button>
                <button type="button" className="btn" onClick={() => setConfirmingClear(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmingClear(true)}>
                Clear all history…
              </button>
            )}
          </div>

          <div className="field">
            <label className="privacy__toggle">
              <input
                type="checkbox"
                checked={view.keepScrollback}
                onChange={(e) => void apply({ keepScrollback: e.target.checked })}
              />
              <span>Restore scrollback after a restart</span>
            </label>
            <p className="hint">
              Saves the last 256 KB of each pane so it comes back when the app does, with secrets
              redacted. Turning this off deletes the scrollback already saved. A private terminal
              never saves its scrollback, whatever this says.
            </p>
          </div>

          <div className="field">
            <span className="field__label">Project folder</span>
            <p className="privacy__folder">
              {view.projectDir ? <code>{view.projectDir}</code> : <em>None set</em>}
            </p>
            <FolderPicker
              label="Project folder"
              action="Use"
              placeholder="~/code/my-project"
              onChoose={(dir) => void chooseFolder(dir)}
              error={folderError}
              clearOnChoose
            />
            <p className="hint">
              Where new terminals start, and the only folder the assistant&apos;s file tools may
              read. Switching to a workspace with a terminal folder sets it too.
            </p>
          </div>
        </>
      )}

      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
