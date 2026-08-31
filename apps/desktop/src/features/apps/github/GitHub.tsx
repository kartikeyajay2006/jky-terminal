import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "../../../platform";
import type {
  GitHubDeviceStart,
  GitHubItem,
  GitHubRepo,
  GitHubSummary,
} from "../../../platform/types";

/** Where the panel is. */
type Phase =
  | { at: "loading" }
  | { at: "needs-client-id" }
  | { at: "signed-out" }
  | { at: "waiting"; start: GitHubDeviceStart }
  | { at: "connected" };

/**
 * How long ago something changed, in the units a person would use.
 *
 * `now` is a parameter so this is testable without freezing the clock, and it
 * gives back null rather than a guess when the date cannot be read — a wrong
 * "updated 3 days ago" is worse than none.
 */
export function relativeDay(iso: string, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;

  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

/**
 * The GitHub app.
 *
 * Signing in uses the device authorization grant: GitHub shows a short code,
 * you approve it on github.com, and your own two-factor settings decide what
 * that takes — a push to GitHub Mobile, a one-time code, a security key. This
 * app never sees a password or a code, and never asks for one.
 *
 * The client id is asked for rather than shipped, because there is no shared
 * OAuth app to point at yet. It is a public identifier, not a secret; the
 * device flow has no client secret at all, which is why none of this puts
 * anything confidential in a binary anyone can download.
 */
export function GitHub() {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [clientId, setClientId] = useState("");
  const [summary, setSummary] = useState<GitHubSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const now = Date.now();

  /**
   * Stops the poll loop when the panel goes away.
   *
   * Without it a sign-in abandoned mid-flow keeps asking GitHub every few
   * seconds for as long as the app is open.
   */
  const polling = useRef(false);
  useEffect(() => () => {
    polling.current = false;
  }, []);

  const loadSummary = useCallback(async () => {
    setError(null);
    try {
      setSummary(await getPlatform().apps.github.summary());
      setPhase({ at: "connected" });
    } catch (e) {
      setSummary(null);
      setPhase({ at: "connected" });
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const status = await getPlatform().apps.github.status();
        // A client id ships with the build, so this is only reachable if a
        // stored one was somehow emptied. The setup screen is the way out.
        if (!status.configured) return setPhase({ at: "needs-client-id" });
        if (!status.connected) return setPhase({ at: "signed-out" });
        await loadSummary();
      } catch (e) {
        setPhase({ at: "needs-client-id" });
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadSummary]);

  async function saveClientId() {
    setSaving(true);
    setError(null);
    try {
      await getPlatform().apps.github.setClientId(clientId);
      const status = await getPlatform().apps.github.status();
      setPhase(status.configured ? { at: "signed-out" } : { at: "needs-client-id" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function signIn() {
    setError(null);
    try {
      const start = await getPlatform().apps.github.connectStart();
      setPhase({ at: "waiting", start });
      polling.current = true;
      void pollUntilDone(start.interval_s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Ask GitHub, on the schedule it dictates, until it stops saying "pending".
   *
   * The interval comes back from each poll because GitHub can raise it
   * mid-flow; carrying on at the old pace gets the next request refused.
   */
  async function pollUntilDone(intervalS: number) {
    let wait = Math.max(1, intervalS);

    while (polling.current) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      if (!polling.current) return;

      let state;
      try {
        state = await getPlatform().apps.github.connectPoll();
      } catch (e) {
        polling.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setPhase({ at: "signed-out" });
        return;
      }

      if (state.state === "pending") {
        wait = Math.max(1, state.interval_s);
        continue;
      }

      polling.current = false;

      if (state.state === "connected") {
        await loadSummary();
      } else {
        setPhase({ at: "signed-out" });
        setError(
          state.state === "denied"
            ? "GitHub refused that sign-in. Nothing was connected."
            : "That code expired before it was approved. Start again.",
        );
      }
      return;
    }
  }

  async function signOut() {
    polling.current = false;
    await getPlatform().apps.github.disconnect();
    setSummary(null);
    setError(null);
    setPhase({ at: "signed-out" });
  }

  function open(url: string) {
    void getPlatform().openExternal(url);
  }

  return (
    <div className="gh">
      {error && (
        <div className="gh__failure">
          <p className="gh__error" role="alert">
            {error}
          </p>
          {phase.at === "connected" && (
            <button type="button" className="gh__retry" onClick={() => void loadSummary()}>
              Try again
            </button>
          )}
        </div>
      )}

      {phase.at === "loading" && <p className="gh__quiet">Checking your account…</p>}

      {phase.at === "needs-client-id" && (
        <section className="gh__setup" aria-label="Set up GitHub">
          <h2 className="gh__setup-title">Use your own OAuth app</h2>
          <p className="gh__setup-body">
            This needs an <b>OAuth App</b> of your own. On GitHub, go to Settings → Developer
            JKY Terminal already has one, so you do not need this. If you would rather sign in
            against an OAuth app of your own: on GitHub, go to Settings → Developer settings →
            OAuth Apps → New OAuth App, tick <b>Enable Device Flow</b>, and paste the Client ID
            here. There is no client secret to copy: the device flow does not use one.
          </p>
          <div className="gh__setup-row">
            <input
              className="gh__input"
              aria-label="Client ID"
              value={clientId}
              spellCheck={false}
              autoComplete="off"
              placeholder="Ov23li…"
              onChange={(e) => setClientId(e.target.value)}
            />
            <button
              type="button"
              className="gh__primary"
              disabled={saving || clientId.trim() === ""}
              onClick={() => void saveClientId()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="gh__setup-links">
            <button
              type="button"
              className="gh__link"
              onClick={() => open("https://github.com/settings/developers")}
            >
              Open GitHub developer settings
            </button>
            <button type="button" className="gh__link" onClick={() => setPhase({ at: "signed-out" })}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {phase.at === "signed-out" && (
        <section className="gh__setup" aria-label="Sign in to GitHub">
          <h2 className="gh__setup-title">Sign in to GitHub</h2>
          <p className="gh__setup-body">
            GitHub will show a short code to approve. Your own two-factor settings decide what
            that takes — a push to GitHub Mobile, a one-time code, or a security key. This app
            never sees your password.
          </p>
          <button type="button" className="gh__primary" onClick={() => void signIn()}>
            Sign in to GitHub
          </button>
          <button
            type="button"
            className="gh__link"
            onClick={() => setPhase({ at: "needs-client-id" })}
          >
            Use your own OAuth app instead
          </button>
        </section>
      )}

      {phase.at === "waiting" && (
        <section className="gh__setup" aria-label="Waiting for approval">
          <h2 className="gh__setup-title">Type this code on GitHub</h2>
          <p className="gh__code">{phase.start.user_code}</p>
          <p className="gh__setup-body">
            at <b>{phase.start.verification_uri}</b> — then approve it however your account is
            set up to. This will finish on its own.
          </p>
          <button
            type="button"
            className="gh__primary"
            onClick={() => open(phase.start.verification_uri)}
          >
            Open GitHub to approve
          </button>
          <button
            type="button"
            className="gh__link"
            onClick={() => {
              polling.current = false;
              setPhase({ at: "signed-out" });
            }}
          >
            Cancel
          </button>
        </section>
      )}

      {phase.at === "connected" && summary && (
        <>
          <header className="gh__head">
            <div>
              <h2 className="gh__login">{summary.user.login}</h2>
              {summary.user.name && <p className="gh__name">{summary.user.name}</p>}
            </div>
            <div className="gh__head-actions">
              <button type="button" className="gh__ghost" onClick={() => void loadSummary()}>
                Refresh
              </button>
              <button type="button" className="gh__ghost" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </header>

          <Items
            label="Pull requests"
            items={summary.pulls}
            empty="Nothing of yours is open."
            onOpen={open}
          />
          <Items
            label="Issues"
            items={summary.issues}
            empty="Nothing is assigned to you."
            onOpen={open}
          />

          <section className="gh__section">
            <h3 className="gh__section-title">Repositories</h3>
            {summary.repos.length === 0 ? (
              <p className="gh__quiet">No repositories yet.</p>
            ) : (
              <ul className="gh__list" aria-label="Repositories">
                {summary.repos.map((repo) => (
                  <li key={repo.full_name}>
                    <RepoRow repo={repo} now={now} onOpen={open} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Items({
  label,
  items,
  empty,
  onOpen,
}: {
  label: string;
  items: GitHubItem[];
  empty: string;
  onOpen: (url: string) => void;
}) {
  return (
    <section className="gh__section">
      <h3 className="gh__section-title">
        {label}
        {items.length > 0 && <span className="gh__count">{items.length}</span>}
      </h3>
      {items.length === 0 ? (
        <p className="gh__quiet">{empty}</p>
      ) : (
        <ul className="gh__list" aria-label={label}>
          {items.map((item) => (
            <li key={item.html_url}>
              <button type="button" className="gh__row" onClick={() => onOpen(item.html_url)}>
                <span className="gh__row-main">
                  <span className="gh__row-title">{item.title}</span>
                  <span className="gh__row-sub">
                    {item.repo && <span className="gh__repo">{item.repo}</span>}
                    <span className="gh__number">#{item.number}</span>
                    {item.draft && <span className="gh__badge">draft</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepoRow({
  repo,
  now,
  onOpen,
}: {
  repo: GitHubRepo;
  now: number;
  onOpen: (url: string) => void;
}) {
  const updated = relativeDay(repo.updated_at, now);
  return (
    <button type="button" className="gh__row" onClick={() => onOpen(repo.html_url)}>
      <span className="gh__row-main">
        <span className="gh__row-title">
          {repo.name}
          {repo.private && <span className="gh__badge">private</span>}
        </span>
        {repo.description && <span className="gh__row-desc">{repo.description}</span>}
        <span className="gh__row-sub">
          {repo.language && <span>{repo.language}</span>}
          {repo.stars > 0 && <span>★ {repo.stars}</span>}
          {repo.open_issues > 0 && <span>{repo.open_issues} open</span>}
          {updated && <span>{updated}</span>}
        </span>
      </span>
    </button>
  );
}
