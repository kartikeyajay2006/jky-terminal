import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getPlatform } from "../../../platform";
import type { GmailMailbox, GmailMessage } from "../../../platform/types";

/** How many rows one view asks for. Each one costs a request to Google. */
const ROWS = 25;

/**
 * The four things to do in the Google console, each with the page to do it on.
 *
 * Written as links rather than directions because "open the Google Cloud
 * console and make a project" assumes you already know where that is, and
 * every one of these pages is two or three menus deep from a console home
 * screen that does not obviously lead to any of them.
 */
const SETUP: { title: string; url: string; button: string; detail: string }[] = [
  {
    title: "Make a project",
    url: "https://console.cloud.google.com/projectcreate",
    button: "Open Google Cloud",
    detail:
      "Any name will do — “JKY Terminal” is fine. Click Create and wait a few seconds for it to appear.",
  },
  {
    title: "Turn on the Gmail API",
    url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    button: "Open the Gmail API",
    detail:
      "Check your new project is the one named at the top of the page, then click Enable.",
  },
  {
    title: "Add yourself as a test user",
    url: "https://console.cloud.google.com/auth/audience",
    button: "Open Audience",
    detail:
      "Choose External if it asks, then add your own Gmail address under Test users. Skip this and Google answers the sign-in with “access denied” — it is the usual reason this fails.",
  },
  {
    title: "Create the client and copy its id",
    url: "https://console.cloud.google.com/auth/clients",
    button: "Open Clients",
    detail:
      "Create client → application type Desktop app → Create. Copy the Client ID it shows you. There is no client secret; a desktop client is issued without one.",
  },
];

/** Where the panel is. */
type Phase =
  | { at: "loading" }
  | { at: "needs-client-id" }
  | { at: "signed-out" }
  | { at: "signing-in" }
  | { at: "connected" };

/**
 * When a message arrived, in the units a person would use.
 *
 * A clock time for today and a date for anything older, because those are the
 * two different questions being asked: "was this while I was at lunch" and
 * "was this last week". `now` is a parameter so this is testable without
 * freezing the clock.
 *
 * An unreadable date gives back nothing rather than a guess. A row with no
 * time looks unremarkable; a row claiming 1 January 1970 looks broken.
 */
export function relativeWhen(ms: number, now: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const when = new Date(ms);
  const sameDay = new Date(now).toDateString() === when.toDateString();
  return sameDay
    ? when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The Gmail app.
 *
 * Read-only, and that is the design rather than a limitation not yet lifted:
 * the scope asked for is `gmail.readonly`, so there is no send, no delete and
 * no label change, and the consent screen a person is shown says exactly that.
 *
 * Only three headers and the snippet are ever fetched. No message body crosses
 * the network, which is why opening one hands it to Gmail in the browser
 * rather than rendering it here — showing the mail would mean fetching the
 * mail, and a terminal has no business holding the contents of your inbox.
 *
 * Signing in cannot happen in this window. Google has answered OAuth requests
 * from embedded webviews with `disallowed_useragent` since July 2023, so the
 * person's own browser does it and Rust waits on a loopback socket for the
 * redirect. That wait is minutes long and the panel says so — a button that
 * looks inert for thirty seconds is a button people click twice.
 */
export function Gmail() {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [mailbox, setMailbox] = useState<GmailMailbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  useEffect(() => {
    void getPlatform()
      .apps.gmail.status()
      .then((status) => {
        if (!status.configured) return setPhase({ at: "needs-client-id" });
        setPhase({ at: status.connected ? "connected" : "signed-out" });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase({ at: "signed-out" });
      });
  }, []);

  const load = useCallback(async (search: string) => {
    setBusy(true);
    setError(null);
    try {
      setMailbox(await getPlatform().apps.gmail.inbox(ROWS, search === "" ? null : search));
    } catch (e) {
      setMailbox(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (phase.at === "connected") void load(query);
  }, [phase.at, query, load]);

  async function saveClientId(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await getPlatform().apps.gmail.setClientId(draft);
      setClientId(draft);
      // The same field becomes the search box two screens later, and a search
      // box arriving pre-filled with a client id is the first thing a new user
      // would see.
      setDraft("");
      setPhase({ at: "signed-out" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function signIn() {
    setPhase({ at: "signing-in" });
    setError(null);
    try {
      await getPlatform().apps.gmail.connect();
      setPhase({ at: "connected" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ at: "signed-out" });
    }
  }

  async function signOut() {
    try {
      await getPlatform().apps.gmail.disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setMailbox(null);
    setQuery("");
    setPhase({ at: "signed-out" });
  }

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery(draft.trim());
  }

  function openMessage(message: GmailMessage) {
    // Gmail's own reader, in the browser. Rendering it here would mean
    // fetching the body, which this app deliberately never does.
    void getPlatform().openExternal(
      `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(message.id)}`,
    );
  }

  if (phase.at === "loading") {
    return <p className="gm__quiet">Checking your mailbox…</p>;
  }

  if (phase.at === "needs-client-id") {
    return (
      <div className="gm gm--setup">
        <section className="gm__setup" aria-label="Set up Gmail">
          <h2 className="gm__title">Set up Gmail</h2>
          <p className="gm__body">
            Google has to know which app is asking to read your mail, so you register one —
            once, free, about five minutes. None ships with JKY Terminal because a Google
            client belongs to whoever made it, and a shared one would list every install of
            this app under one stranger's account.
          </p>
          <p className="gm__body">
            Each step below opens the page it happens on. Do them in order.
          </p>

          <ol className="gm__steps" aria-label="Set up steps">
            {SETUP.map((step, i) => (
              <li key={step.url} className="gm__step">
                <span className="gm__step-no" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="gm__step-body">
                  <span className="gm__step-title">{step.title}</span>
                  <span className="gm__step-detail">{step.detail}</span>
                </span>
                <button
                  type="button"
                  className="gm__step-go"
                  onClick={() => void getPlatform().openExternal(step.url)}
                >
                  {step.button} ↗
                </button>
              </li>
            ))}
          </ol>

          <form className="gm__form" onSubmit={(e) => void saveClientId(e)}>
            <label className="gm__label" htmlFor="gm-client">
              Client id
            </label>
            <input
              id="gm-client"
              className="gm__input"
              value={draft}
              spellCheck={false}
              autoComplete="off"
              placeholder="000000000000-xxxx.apps.googleusercontent.com"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="gm__go" disabled={draft.trim() === ""}>
              Save
            </button>
          </form>
          <p className="gm__quiet">
            It is one long line ending in <span className="gm__strong">.apps.googleusercontent.com</span>.
            Nothing here is secret, and nothing is sent anywhere but Google.
          </p>
          {error && (
            <p className="gm__error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  if (phase.at === "signed-out" || phase.at === "signing-in") {
    const waiting = phase.at === "signing-in";
    return (
      <div className="gm gm--setup">
        <section className="gm__setup" aria-label="Sign in to Gmail">
          <h2 className="gm__title">Sign in to Gmail</h2>
          <p className="gm__body">
            Google will not accept a sign-in from inside an app window, so this opens your own
            browser. Approve it there and come back — this panel is waiting.
          </p>
          <p className="gm__body">
            You will be asked for <span className="gm__strong">read-only</span> access. That is
            all this app can do with your mail: it cannot send, delete or label anything, and it
            never fetches a message body.
          </p>
          <button
            type="button"
            className="gm__go"
            disabled={waiting}
            onClick={() => void signIn()}
          >
            {waiting ? "Waiting for your browser…" : "Sign in with Google"}
          </button>
          {clientId !== "" && <p className="gm__quiet">Using the client id you just saved.</p>}
          {error && (
            <p className="gm__error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="gm">
      <header className="gm__bar">
        <div className="gm__who">
          <span className="gm__address">{mailbox?.account.address ?? "your mailbox"}</span>
          <span className="gm__note">read-only</span>
        </div>

        <form className="gm__search" role="search" onSubmit={search}>
          <input
            type="search"
            className="gm__input"
            aria-label="Search the mailbox"
            placeholder="Search all mail"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>

        <button type="button" className="gm__ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      {error && (
        <p className="gm__error" role="alert">
          {error}
        </p>
      )}

      {busy && !mailbox && <p className="gm__quiet">Reading your mail…</p>}

      {mailbox && mailbox.messages.length === 0 && (
        <p className="gm__quiet">
          Nothing here.{query !== "" && " No message matches that search."}
        </p>
      )}

      {mailbox && mailbox.messages.length > 0 && (
        <ul className="gm__list" aria-label={query === "" ? "Inbox" : "Search results"}>
          {mailbox.messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                className="gm__row"
                data-unread={message.unread ? "" : undefined}
                onClick={() => openMessage(message)}
              >
                <span className="gm__from" title={message.from_address}>
                  {message.from_name}
                </span>
                <span className="gm__line">
                  <span className="gm__subject">{message.subject}</span>
                  <span className="gm__snippet">{message.snippet}</span>
                </span>
                <span className="gm__meta">
                  {message.unread && <span className="gm__badge">Unread</span>}
                  <span className="gm__when">{relativeWhen(message.received_ms, now)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
