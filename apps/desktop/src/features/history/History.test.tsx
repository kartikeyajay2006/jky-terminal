import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { History, when } from "./History";
import { getPlatform } from "../../platform";
import { useTabs } from "../../app/tabStore";
import { TYPE_EVENT, type TypeRequest } from "../terminal/typeEvent";

const NOW = 1_800_000_000_000;

async function seed(commands: Array<{ command: string; code?: number; cwd?: string }>) {
  const history = getPlatform().history;
  await history.clear();
  for (const [i, c] of commands.entries()) {
    await history.record({
      command: c.command,
      cwd: c.cwd ?? "/home/k",
      code: c.code ?? 0,
      at: NOW - (commands.length - i) * 1000,
      session: "pane-1",
    });
  }
}

describe("the history section", () => {
  beforeEach(async () => {
    await getPlatform().history.clear();
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("lists what has been run", async () => {
    await seed([{ command: "docker ps" }, { command: "git status" }]);
    render(<History />);
    expect(await screen.findByRole("button", { name: "docker ps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "git status" })).toBeInTheDocument();
  });

  it("finds a command by letters scattered through it", async () => {
    // How people actually remember a command.
    await seed([{ command: "docker ps" }, { command: "git status" }]);
    const user = userEvent.setup();
    render(<History />);
    await screen.findByRole("button", { name: "docker ps" });

    await user.type(screen.getByRole("searchbox"), "dkrps");
    await waitFor(() => expect(screen.queryByRole("button", { name: "git status" })).toBeNull());
    expect(screen.getByRole("button", { name: "docker ps" })).toBeInTheDocument();
  });

  it("narrows to what failed", async () => {
    await seed([{ command: "cargo test" }, { command: "cargo build", code: 101 }]);
    const user = userEvent.setup();
    render(<History />);
    await screen.findByRole("button", { name: "cargo test" });

    await user.click(screen.getByLabelText("Only what failed"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "cargo test" })).toBeNull());
    expect(screen.getByRole("button", { name: "cargo build" })).toBeInTheDocument();
  });

  it("shows a command once however often it ran, with the count", async () => {
    // Forty identical rows would bury everything else ever run.
    await seed([{ command: "ls" }, { command: "ls" }, { command: "ls" }]);
    render(<History />);
    expect(await screen.findAllByRole("button", { name: "ls" })).toHaveLength(1);
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("types a command onto the prompt rather than running it", async () => {
    // The same rule the command panels follow: a history that executed what
    // you clicked would be one you had to be careful browsing.
    await seed([{ command: "npm run verify" }]);
    const tabId = useTabs.getState().openTab("terminal", "one");
    const seen: TypeRequest[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent<TypeRequest>).detail);
    window.addEventListener(TYPE_EVENT, listen);

    const user = userEvent.setup();
    render(<History />);
    await user.click(await screen.findByRole("button", { name: "npm run verify" }));

    window.removeEventListener(TYPE_EVENT, listen);
    expect(seen).toEqual([{ pane: tabId, text: "npm run verify" }]);
  });

  it("forgets every run of a command, not the row being looked at", async () => {
    await seed([{ command: "curl -H 'Authorization: Bearer sekrit'" }, { command: "ls" }]);
    const forget = vi.spyOn(getPlatform().history, "forget");
    const user = userEvent.setup();
    render(<History />);

    await user.click(
      await screen.findByRole("button", {
        name: "Forget every run of curl -H 'Authorization: Bearer sekrit'",
      }),
    );
    expect(forget).toHaveBeenCalledWith("curl -H 'Authorization: Bearer sekrit'");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Authorization/ })).toBeNull(),
    );
    forget.mockRestore();
  });

  it("says so when there is nothing rather than showing an empty table", async () => {
    render(<History />);
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });

  it("says which search found nothing", async () => {
    await seed([{ command: "ls" }]);
    const user = userEvent.setup();
    render(<History />);
    await screen.findByRole("button", { name: "ls" });

    await user.type(screen.getByRole("searchbox"), "kubectl");
    expect(await screen.findByText(/Nothing matching/)).toBeInTheDocument();
  });

  it("reports a failure to read rather than looking empty", async () => {
    vi.spyOn(getPlatform().history, "search").mockRejectedValueOnce(new Error("disk on fire"));
    render(<History />);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk on fire");
  });
});

describe("how long ago", () => {
  it("uses the roughest unit that is still true", () => {
    const ago = (ms: number) => when(NOW - ms, NOW);
    expect(ago(5_000)).toBe("just now");
    expect(ago(5 * 60_000)).toBe("5m ago");
    expect(ago(3 * 3_600_000)).toBe("3h ago");
    expect(ago(4 * 86_400_000)).toBe("4d ago");
    expect(ago(60 * 86_400_000)).toBe("2mo ago");
    expect(ago(800 * 86_400_000)).toBe("2y ago");
  });

  it("never reports the future as a negative age", () => {
    // Clocks move backwards — NTP, a laptop waking in another timezone.
    expect(when(NOW + 10_000, NOW)).toBe("just now");
  });
});
