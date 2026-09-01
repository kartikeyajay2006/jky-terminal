import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Gmail, relativeWhen } from "./Gmail";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { GmailMailbox, GmailStatus, Platform } from "../../../platform/types";

const CLIENT = "812345678901-preview.apps.googleusercontent.com";
const SECRET = "GOCSPX-preview0000000000000000";

const MAILBOX: GmailMailbox = {
  account: { address: "someone@example.com", messages_total: 12043 },
  messages: [
    {
      id: "18f0a1",
      thread_id: "18f0a1",
      from_name: "Ada Lovelace",
      from_address: "ada@example.com",
      subject: "Deploy finished",
      snippet: "The smoke tests are green. Nothing to do.",
      received_ms: Date.parse("2026-08-31T12:00:00Z"),
      unread: true,
    },
    {
      id: "18f0a2",
      thread_id: "18f09f",
      from_name: "billing@example.net",
      from_address: "billing@example.net",
      subject: "Receipt",
      snippet: "Your receipt is attached.",
      received_ms: Date.parse("2026-08-30T09:14:00Z"),
      unread: false,
    },
  ],
};

interface Log {
  connects: number;
  disconnects: number;
  ids: string[];
  opened: string[];
  secrets: string[];
  queries: (string | null)[];
}

function fresh(): Log {
  return { connects: 0, disconnects: 0, ids: [], opened: [], secrets: [], queries: [] };
}

/** A platform whose Gmail behaves, recording what it was asked. */
function withGmail(
  log: Log,
  status: GmailStatus,
  overrides: Partial<Platform["apps"]["gmail"]> = {},
): Platform {
  const base = createWebPlatform();
  let current = { ...status };
  return {
    ...base,
    apps: {
      ...base.apps,
      gmail: {
        async status() {
          return current;
        },
        async configure(id, secret) {
          if (secret.trim() === "") throw new Error("the client secret is missing");
          log.ids.push(id);
          log.secrets.push(secret);
          current = { ...current, configured: true };
        },
        async connect() {
          log.connects += 1;
          current = { ...current, connected: true };
          return MAILBOX.account.address;
        },
        async disconnect() {
          log.disconnects += 1;
          current = { ...current, connected: false };
        },
        async message(id) {
          const found = MAILBOX.messages.find((m) => m.id === id);
          if (!found) throw new Error("no such message");
          log.opened.push(id);
          return { message: found, body: `The text of ${found.subject}.` };
        },
        async inbox(_count, query) {
          log.queries.push(query);
          if (!current.connected) throw new Error("not connected to Gmail");
          const needle = query?.trim().toLowerCase() ?? "";
          return {
            account: MAILBOX.account,
            messages:
              needle === ""
                ? MAILBOX.messages
                : MAILBOX.messages.filter((m) =>
                    m.subject.toLowerCase().includes(needle),
                  ),
          };
        },
        ...overrides,
      },
    },
  };
}

const typist = () => userEvent.setup({ delay: null });

describe("relativeWhen", () => {
  const now = Date.parse("2026-08-31T18:00:00Z");

  // Today is the common case and the one where a clock time is what a person
  // actually wants; a date for something that arrived an hour ago is useless.
  it("shows a clock time for today and a date for anything older", () => {
    expect(relativeWhen(Date.parse("2026-08-31T09:05:00Z"), now)).toMatch(/\d/);
    expect(relativeWhen(Date.parse("2026-08-31T09:05:00Z"), now)).not.toMatch(/Aug|Jul/);
    expect(relativeWhen(Date.parse("2026-08-24T09:05:00Z"), now)).toMatch(/Aug/);
  });

  // A row with a blank where the time goes looks like a bug. A message with
  // no readable date is real — say nothing rather than guess.
  it("says nothing rather than guessing at a date it cannot read", () => {
    expect(relativeWhen(0, now)).toBe("");
    expect(relativeWhen(Number.NaN, now)).toBe("");
  });
});

describe("Gmail", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  // No Google client id ships, so a fresh install is not merely signed out —
  // there is nothing yet to sign in against, and saying "sign in" would send
  // someone looking for a button that cannot work yet.
  it("explains what to set up before offering to sign in", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    expect(await screen.findByRole("textbox", { name: /client id/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign in/i })).not.toBeInTheDocument();
  });

  it("says where to get a client id", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    const setup = await screen.findByRole("region", { name: /set up gmail/i });
    expect(setup).toHaveTextContent(/google cloud/i);
    expect(setup).toHaveTextContent(/desktop app/i);
  });

  /*
   * "Open the Google Cloud console and make a project" is a sentence that
   * assumes you already know where that is. Every step opens its own page
   * instead, so the instruction is a button rather than a search.
   */
  it("opens each step's page rather than describing where to find it", async () => {
    const opened: string[] = [];
    const base = withGmail(fresh(), { configured: false, connected: false });
    __setPlatformForTests({
      ...base,
      async openExternal(url: string) {
        opened.push(url);
      },
    });
    const user = typist();
    render(<Gmail />);

    const steps = await screen.findByRole("list", { name: /set up/i });
    const buttons = within(steps).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) await user.click(button);

    expect(opened).toHaveLength(buttons.length);
    for (const url of opened) expect(url).toMatch(/^https:\/\/console\.cloud\.google\.com\//);
    expect(opened.some((u) => u.includes("projectcreate"))).toBe(true);
    expect(opened.some((u) => u.includes("gmail.googleapis.com"))).toBe(true);
    expect(opened.some((u) => u.includes("audience"))).toBe(true);
    expect(opened.some((u) => u.includes("clients"))).toBe(true);
  });

  /*
   * The single most common way this fails: Google puts a new project in
   * testing mode, and testing mode refuses everyone not on the test-user
   * list — including the person who just made the project. The error it gives
   * back says "access denied" and names nothing you could act on.
   */
  it("warns about the step whose absence looks like a refusal", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    const setup = await screen.findByRole("region", { name: /set up gmail/i });
    expect(setup).toHaveTextContent(/test user/i);
    expect(setup).toHaveTextContent(/access denied/i);
  });

  // Two details that cost an hour each when missed: the wrong client type
  // fails at the redirect, and people hunt for a secret that is not issued.
  it("names the client type", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    expect(await screen.findByRole("region", { name: /set up gmail/i })).toHaveTextContent(
      /desktop app/i,
    );
  });

  // The field refuses a project id with a message naming the right problem,
  // and the panel should show what the right answer looks like.
  it("shows the shape of the thing being asked for", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    const box = await screen.findByRole("textbox", { name: /client id/i });
    expect(box).toHaveAttribute("placeholder", expect.stringContaining("apps.googleusercontent.com"));
  });

  /*
   * Both halves, or none.
   *
   * Google requires a client_secret at the token endpoint even for an
   * installed app, which the OAuth spec calls a public client and PKCE exists
   * to make safe without one. Asking for the id alone produced the worst
   * possible failure: the browser opened, consent was given, the code came
   * back to the loopback, and only then did the one request nobody sees get
   * refused — "the sign-in was not completed: client_secret is missing".
   */
  it("saves both halves of the client and then offers to sign in", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: false, connected: false }));
    const user = typist();
    render(<Gmail />);

    await user.type(await screen.findByRole("textbox", { name: /client id/i }), CLIENT);
    await user.type(screen.getByLabelText(/client secret/i), SECRET);
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(log.ids).toEqual([CLIENT]));
    expect(log.secrets).toEqual([SECRET]);
    expect(await screen.findByRole("button", { name: /^sign in/i })).toBeInTheDocument();
  });

  it("will not save an id with no secret beside it", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: false, connected: false }));
    const user = typist();
    render(<Gmail />);

    await user.type(await screen.findByRole("textbox", { name: /client id/i }), CLIENT);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(log.ids).toEqual([]);
  });

  // The secret is on the same console page as the id, and the step that says
  // "there is no secret to copy" was wrong and cost a whole sign-in.
  it("says the secret is on the same page as the id", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: false, connected: false }));
    render(<Gmail />);
    const setup = await screen.findByRole("region", { name: /set up gmail/i });
    expect(setup).toHaveTextContent(/client secret/i);
    expect(setup).not.toHaveTextContent(/no client secret to copy|there is no client secret/i);
  });

  // The setup field and the search box are two different questions sharing
  // one piece of state. Without clearing it, the first thing a new user sees
  // after signing in is their own client id sitting in the search box.
  it("does not leave the client id in the search box afterwards", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: false, connected: false }));
    const user = typist();
    render(<Gmail />);

    await user.type(await screen.findByRole("textbox", { name: /client id/i }), CLIENT);
    await user.type(screen.getByLabelText(/client secret/i), SECRET);
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: /^sign in/i }));

    const box = await screen.findByRole("searchbox", { name: /search/i });
    expect(box).toHaveValue("");
  });

  // Signing in happens in a different application. A button that looks like
  // it did nothing for thirty seconds is one people click again.
  it("says the sign-in happens in the browser, before it opens one", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: false }));
    render(<Gmail />);
    const note = await screen.findByRole("region", { name: /sign in to gmail/i });
    expect(note).toHaveTextContent(/browser/i);
    expect(note).toHaveTextContent(/read/i);
  });

  it("waits visibly while the browser is open", async () => {
    const log = fresh();
    let release: (address: string) => void = () => {};
    __setPlatformForTests(
      withGmail(log, { configured: true, connected: false }, {
        connect: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      }),
    );
    const user = typist();
    render(<Gmail />);

    await user.click(await screen.findByRole("button", { name: /^sign in/i }));
    expect(await screen.findByText(/waiting for your browser/i)).toBeInTheDocument();
    release("someone@example.com");
  });

  it("lists the inbox once signed in", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    expect(within(list).getByText("Deploy finished")).toBeInTheDocument();
    expect(within(list).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(list).getByText(/smoke tests are green/i)).toBeInTheDocument();
  });

  it("shows which mailbox is being read", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);
    expect(await screen.findByText("someone@example.com")).toBeInTheDocument();
  });

  // Unread is the one distinction a mail list exists to make, and colour
  // alone would not carry it for someone who cannot see the difference.
  it("marks unread messages in words, not only in weight", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]).getByText(/unread/i)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/unread/i)).not.toBeInTheDocument();
  });

  it("searches the mailbox", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: true, connected: true }));
    const user = typist();
    render(<Gmail />);
    await screen.findByRole("list", { name: /inbox/i });

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "receipt{Enter}");

    await waitFor(() => expect(log.queries).toContain("receipt"));
    await waitFor(() => expect(screen.queryByText("Deploy finished")).not.toBeInTheDocument());
    expect(screen.getByText("Receipt")).toBeInTheDocument();
  });

  it("goes back to the whole inbox when the search is cleared", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: true, connected: true }));
    const user = typist();
    render(<Gmail />);
    await screen.findByRole("list", { name: /inbox/i });

    const box = screen.getByRole("searchbox", { name: /search/i });
    await user.type(box, "receipt{Enter}");
    await waitFor(() => expect(screen.queryByText("Deploy finished")).not.toBeInTheDocument());

    await user.clear(box);
    await user.type(box, "{Enter}");
    expect(await screen.findByText("Deploy finished")).toBeInTheDocument();
  });

  it("says so when a mailbox cannot be read", async () => {
    __setPlatformForTests(
      withGmail(fresh(), { configured: true, connected: true }, {
        async inbox() {
          throw new Error("could not reach Gmail");
        },
      }),
    );
    render(<Gmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach gmail/i);
  });

  it("signs out", async () => {
    const log = fresh();
    __setPlatformForTests(withGmail(log, { configured: true, connected: true }));
    const user = typist();
    render(<Gmail />);
    await screen.findByRole("list", { name: /inbox/i });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(log.disconnects).toBe(1));
    expect(await screen.findByRole("button", { name: /^sign in/i })).toBeInTheDocument();
  });

  // The panel is read-only by construction, and the only place a person can
  // learn that is the panel itself.
  it("says that it can only read", async () => {
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);
    await screen.findByRole("list", { name: /inbox/i });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  // An empty inbox is a real state, and a spinner that never resolves is how
  // it looks if the panel does not say so.
  it("says when there is nothing to read", async () => {
    __setPlatformForTests(
      withGmail(fresh(), { configured: true, connected: true }, {
        async inbox() {
          return { account: MAILBOX.account, messages: [] };
        },
      }),
    );
    render(<Gmail />);
    expect(await screen.findByText(/nothing here/i)).toBeInTheDocument();
  });

  /*
   * Opening a message used to hand it to Gmail in a browser, because no body
   * was ever fetched. It is read here now — which is a real change of mind
   * about what this app fetches, not a feature bolted on: the list still asks
   * for metadata only, and exactly one message's text is fetched, the one
   * that was opened.
   */
  it("opens the message here rather than in a browser", async () => {
    const log = fresh();
    const externals: string[] = [];
    const base = withGmail(log, { configured: true, connected: true });
    __setPlatformForTests({
      ...base,
      async openExternal(url: string) {
        externals.push(url);
      },
    });
    const user = typist();
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);

    expect(await screen.findByText(/The text of Deploy finished\./)).toBeInTheDocument();
    expect(log.opened).toEqual(["18f0a1"]);
    expect(externals, "nothing should have been handed to a browser").toEqual([]);
  });

  it("shows who the open message is from, and when", async () => {
    const user = typist();
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);

    const reading = await screen.findByRole("article", { name: /deploy finished/i });
    expect(reading).toHaveTextContent("Ada Lovelace");
    expect(reading).toHaveTextContent("ada@example.com");
  });

  // The list stays beside the message rather than being replaced by it, so
  // reading one does not cost you your place in the mailbox.
  it("keeps the list while a message is open", async () => {
    const user = typist();
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);
    await screen.findByRole("article", { name: /deploy finished/i });

    expect(screen.getByRole("list", { name: /inbox/i })).toBeInTheDocument();
  });

  it("closes the message and goes back to the list alone", async () => {
    const user = typist();
    __setPlatformForTests(withGmail(fresh(), { configured: true, connected: true }));
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);
    await screen.findByRole("article", { name: /deploy finished/i });

    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: /deploy finished/i })).not.toBeInTheDocument(),
    );
  });

  it("says so when a message cannot be read", async () => {
    const base = withGmail(fresh(), { configured: true, connected: true });
    __setPlatformForTests({
      ...base,
      apps: {
        ...base.apps,
        gmail: {
          ...base.apps.gmail,
          async message() {
            throw new Error("could not reach Gmail");
          },
        },
      },
    });
    const user = typist();
    render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach gmail/i);
  });

  // The one thing that must never happen: a message's markup rendered as
  // markup. Rust strips it, and this checks the panel does not undo that.
  it("renders the body as text, never as markup", async () => {
    const base = withGmail(fresh(), { configured: true, connected: true });
    __setPlatformForTests({
      ...base,
      apps: {
        ...base.apps,
        gmail: {
          ...base.apps.gmail,
          async message(id: string) {
            const found = MAILBOX.messages.find((m) => m.id === id)!;
            return { message: found, body: "<img src=x onerror=alert(1)> plain words" };
          },
        },
      },
    });
    const user = typist();
    const { container } = render(<Gmail />);

    const list = await screen.findByRole("list", { name: /inbox/i });
    await user.click(within(list).getAllByRole("button")[0]);
    await screen.findByRole("article", { name: /deploy finished/i });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/plain words/)).toBeInTheDocument();
  });
});
