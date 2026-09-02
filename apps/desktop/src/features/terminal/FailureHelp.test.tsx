import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FailureHelp } from "./FailureHelp";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import type { Platform, ProviderStatus } from "../../platform/types";

const FAILURE = { code: 128, cwd: "/repo", command: "git push" };
const OUTPUT = "! [rejected]  main -> main (non-fast-forward)";

const provider = (id: string, requiresKey: boolean, connected: boolean): ProviderStatus => ({
  id,
  displayName: id === "anthropic" ? "Anthropic" : id,
  tagline: "",
  consoleUrl: "",
  requiresKey,
  keyPrefixes: [],
  connected,
  models: [],
  defaultModel: "",
  selectedModel: null,
});

interface Log {
  asked: { provider: string; prompt: string }[];
}

function withAi(log: Log, providers: ProviderStatus[], answer?: () => Promise<string>): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    vault: { ...base.vault, async listProviders() { return providers; } },
    ai: {
      ...base.ai,
      async askOnce(provider: string, prompt: string) {
        log.asked.push({ provider, prompt });
        return answer ? answer() : "Your remote has commits you do not have locally.";
      },
    },
  };
}

const fresh = (): Log => ({ asked: [] });
const typist = () => userEvent.setup();

function show(platform: Platform, onDismiss = () => {}) {
  __setPlatformForTests(platform);
  return render(
    <FailureHelp failure={FAILURE} recentOutput={() => OUTPUT} onDismiss={onDismiss} />,
  );
}

describe("FailureHelp", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  it("says what failed and how", async () => {
    show(withAi(fresh(), [provider("anthropic", true, true)]));
    const panel = await screen.findByRole("group", { name: /command failed/i });
    expect(panel).toHaveTextContent("git push");
    expect(panel).toHaveTextContent("128");
  });

  it("offers the four choices", async () => {
    show(withAi(fresh(), [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });
    for (const name of [/explain/i, /^fix$/i, /show commands/i, /ignore/i]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  /*
   * The whole token policy in one test.
   *
   * The offer appears under every failed command, so if appearing cost
   * anything it would be the most expensive feature in the app. It is drawn
   * from what the terminal already knows; nothing is sent until a button is
   * pressed.
   */
  it("sends nothing until a choice is made", async () => {
    const log = fresh();
    show(withAi(log, [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });

    expect(log.asked).toEqual([]);

    await typist().click(screen.getByRole("button", { name: /explain/i }));
    await waitFor(() => expect(log.asked).toHaveLength(1));
  });

  it("sends the command and the output it was given", async () => {
    const log = fresh();
    show(withAi(log, [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });
    await typist().click(screen.getByRole("button", { name: /explain/i }));

    await waitFor(() => expect(log.asked).toHaveLength(1));
    expect(log.asked[0].prompt).toContain("git push");
    expect(log.asked[0].prompt).toContain("non-fast-forward");
    expect(log.asked[0].provider).toBe("anthropic");
  });

  it("shows the answer", async () => {
    show(withAi(fresh(), [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });
    await typist().click(screen.getByRole("button", { name: /explain/i }));

    expect(await screen.findByText(/commits you do not have locally/i)).toBeInTheDocument();
  });

  it("asks a different question for each choice", async () => {
    const log = fresh();
    show(withAi(log, [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });
    const user = typist();

    await user.click(screen.getByRole("button", { name: /explain/i }));
    await waitFor(() => expect(log.asked).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /show commands/i }));
    await waitFor(() => expect(log.asked).toHaveLength(2));

    expect(log.asked[0].prompt).not.toBe(log.asked[1].prompt);
  });

  it("goes away when ignored", async () => {
    let dismissed = 0;
    show(withAi(fresh(), [provider("anthropic", true, true)]), () => {
      dismissed += 1;
    });
    await screen.findByRole("group", { name: /command failed/i });

    await typist().click(screen.getByRole("button", { name: /ignore/i }));
    expect(dismissed).toBe(1);
  });

  /*
   * With nothing configured, the honest thing is to say so once — not to
   * offer four buttons that all fail the same way.
   */
  it("asks for a key when there is nothing that could answer", async () => {
    const log = fresh();
    show(withAi(log, [provider("anthropic", true, false)]));

    const panel = await screen.findByRole("group", { name: /command failed/i });
    expect(panel).toHaveTextContent(/api key/i);
    expect(panel).toHaveTextContent(/ollama/i);
    expect(screen.queryByRole("button", { name: /explain/i })).not.toBeInTheDocument();
    expect(log.asked).toEqual([]);
  });

  // A local runtime needs no key, so it is not "nothing configured".
  it("offers to help when only a local runtime is set up", async () => {
    show(withAi(fresh(), [provider("ollama", false, false)]));
    await screen.findByRole("group", { name: /command failed/i });
    expect(await screen.findByRole("button", { name: /explain/i })).toBeInTheDocument();
  });

  it("can still be dismissed when there is nothing to ask", async () => {
    let dismissed = 0;
    show(withAi(fresh(), [provider("anthropic", true, false)]), () => {
      dismissed += 1;
    });
    await screen.findByRole("group", { name: /command failed/i });
    await typist().click(screen.getByRole("button", { name: /ignore|dismiss|close/i }));
    expect(dismissed).toBe(1);
  });

  it("says so when the request fails, rather than showing nothing", async () => {
    show(
      withAi(fresh(), [provider("anthropic", true, true)], () =>
        Promise.reject(new Error("the provider rejected the request")),
      ),
    );
    await screen.findByRole("group", { name: /command failed/i });
    await typist().click(screen.getByRole("button", { name: /explain/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/rejected the request/i);
  });

  // Number keys, because the panel shows them and a terminal is a keyboard.
  it("takes the number shown beside each choice", async () => {
    const log = fresh();
    show(withAi(log, [provider("anthropic", true, true)]));
    await screen.findByRole("group", { name: /command failed/i });

    await typist().keyboard("2");
    await waitFor(() => expect(log.asked).toHaveLength(1));
    expect(log.asked[0].prompt).toMatch(/single command/i);
  });

  it("dismisses on the fourth key and on Escape", async () => {
    let dismissed = 0;
    show(withAi(fresh(), [provider("anthropic", true, true)]), () => {
      dismissed += 1;
    });
    await screen.findByRole("group", { name: /command failed/i });

    await typist().keyboard("4");
    expect(dismissed).toBe(1);
    await typist().keyboard("{Escape}");
    expect(dismissed).toBe(2);
  });

  // Asking twice for the same thing spends twice for one answer.
  it("does not ask again while an answer is already coming", async () => {
    const log = fresh();
    let release: (text: string) => void = () => {};
    show(
      withAi(log, [provider("anthropic", true, true)], () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      ),
    );
    await screen.findByRole("group", { name: /command failed/i });
    const user = typist();

    await user.click(screen.getByRole("button", { name: /explain/i }));
    await waitFor(() => expect(log.asked).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /explain/i }));

    expect(log.asked).toHaveLength(1);
    release("done");
  });
});
