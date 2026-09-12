import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortsTool } from "./PortsTool";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { Listener, Platform, PortSort } from "../../../platform/types";

const listener = (over: Partial<Listener> = {}): Listener => ({
  port: 3000,
  protocol: "tcp",
  reach: "local",
  pid: 42,
  process: "node",
  command: "node server.js",
  addresses: ["127.0.0.1"],
  ...over,
});

interface Log {
  asked: { sort: PortSort; search: string }[];
  ended: number[];
}

const fresh = (): Log => ({ asked: [], ended: [] });

function withPorts(log: Log, rows: Listener[], ended = true): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    tools: {
      ...base.tools,
      async ports(sort, search) {
        log.asked.push({ sort, search });
        return rows;
      },
      async endProcess(pid) {
        log.ended.push(pid);
        return ended;
      },
    },
  };
}

function show(platform: Platform) {
  __setPlatformForTests(platform);
  return render(<PortsTool />);
}

const rowFor = (port: number) =>
  within(screen.getByRole("table", { name: /listening ports/i }))
    .getAllByRole("row")
    .find((r) => within(r).queryByText(String(port)));

describe("PortsTool", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => {
    __setPlatformForTests(null);
    vi.useRealTimers();
  });

  it("says what is listening and what holds it", async () => {
    show(withPorts(fresh(), [listener({ port: 5173, process: "node", command: "vite dev" })]));

    expect(await screen.findByText("5173")).toBeInTheDocument();
    expect(screen.getByText("vite dev")).toBeInTheDocument();
  });

  it("marks what the network can reach apart from what it cannot", async () => {
    show(
      withPorts(fresh(), [
        listener({ port: 3000, reach: "local" }),
        listener({ port: 8080, reach: "network", pid: 7, addresses: ["0.0.0.0"] }),
      ]),
    );

    await screen.findByText("3000");
    expect(within(rowFor(3000)!).getByText(/this machine/i)).toBeInTheDocument();
    expect(within(rowFor(8080)!).getByText(/network/i)).toBeInTheDocument();
  });

  it("says once, above the table, that something is exposed", async () => {
    show(
      withPorts(fresh(), [
        listener({ port: 8080, reach: "network", pid: 7 }),
        listener({ port: 9090, reach: "network", pid: 8 }),
      ]),
    );

    // The fact that changes what you do, said in words — counting coloured
    // pills yourself is not reading.
    expect(await screen.findByText(/2 of these are reachable from the network/i)).toBeInTheDocument();
  });

  it("stays quiet when nothing is exposed", async () => {
    show(withPorts(fresh(), [listener({ reach: "local" })]));
    await screen.findByText("3000");
    expect(screen.queryByText(/reachable from the network/i)).not.toBeInTheDocument();
  });

  it("names the convention for a port that has one", async () => {
    show(withPorts(fresh(), [listener({ port: 5432, process: "postgres", command: "" })]));
    expect(await screen.findByText(/postgres ·/i)).toBeInTheDocument();
  });

  it("asks before it ends anything", async () => {
    const log = fresh();
    show(withPorts(log, [listener({ port: 3000, pid: 42, process: "node" })]));
    await screen.findByText("3000");

    await userEvent.click(screen.getByRole("button", { name: /free port 3000/i }));

    // Nothing has happened yet. A click that kills a process without a
    // question is one people stop trusting the panel over.
    expect(log.ended).toEqual([]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("ends it only on the second, named click", async () => {
    const log = fresh();
    show(withPorts(log, [listener({ port: 3000, pid: 42 })]));
    await screen.findByText("3000");

    await userEvent.click(screen.getByRole("button", { name: /free port 3000/i }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /free port 3000/i }),
    );

    expect(log.ended).toEqual([42]);
  });

  it("backs out without ending anything", async () => {
    const log = fresh();
    show(withPorts(log, [listener({ port: 3000, pid: 42 })]));
    await screen.findByText("3000");

    await userEvent.click(screen.getByRole("button", { name: /free port 3000/i }));
    await userEvent.click(screen.getByRole("button", { name: /leave it running/i }));

    expect(log.ended).toEqual([]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not claim the port is free, only that it asked", async () => {
    const log = fresh();
    show(withPorts(log, [listener({ port: 3000, pid: 42, process: "node" })]));
    await screen.findByText("3000");

    await userEvent.click(screen.getByRole("button", { name: /free port 3000/i }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /free port 3000/i }),
    );

    // A process may ignore the signal. Saying "freed" would be a lie the
    // panel repeats every time somebody runs something stubborn.
    expect(await screen.findByText(/if it ignores that, it will still be here/i)).toBeInTheDocument();
  });

  it("still lists a port whose owner this user may not see", async () => {
    show(withPorts(fresh(), [listener({ port: 80, pid: null, process: "", command: "" })]));

    await screen.findByText("80");
    // That the port is taken is the answer, even when what has it is not
    // something this user is allowed to know.
    expect(screen.getByText(/another user/i)).toBeInTheDocument();
    // And nothing it cannot do is offered.
    expect(screen.queryByRole("button", { name: /free port 80/i })).not.toBeInTheDocument();
  });

  it("passes the order and the search to Rust rather than filtering here", async () => {
    const log = fresh();
    show(withPorts(log, [listener()]));
    await screen.findByText("3000");

    await userEvent.click(screen.getByRole("button", { name: /^process$/i }));
    await waitFor(() => expect(log.asked.at(-1)?.sort).toBe("process"));

    await userEvent.type(screen.getByRole("searchbox", { name: /search ports/i }), "vite");
    await waitFor(() => expect(log.asked.at(-1)?.search).toBe("vite"));
  });

  it("tells the difference between still reading and nothing listening", async () => {
    show(withPorts(fresh(), []));
    // Before the first answer, "nothing is listening" would be a claim the
    // panel has not earned yet.
    expect(screen.getByText(/reading the socket table/i)).toBeInTheDocument();
    expect(await screen.findByText(/nothing is listening/i)).toBeInTheDocument();
  });

  it("says why it is empty when a search is what emptied it", async () => {
    const log = fresh();
    show(withPorts(log, []));
    await screen.findByText(/nothing is listening/i);

    await userEvent.type(screen.getByRole("searchbox", { name: /search ports/i }), "zzz");
    expect(await screen.findByText(/nothing matches that/i)).toBeInTheDocument();
  });

  it("reports a table it could not read instead of showing an empty one", async () => {
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      tools: {
        ...base.tools,
        async ports() {
          throw new Error("the socket table could not be read: permission denied");
        },
      },
    });
    render(<PortsTool />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/permission denied/i);
    expect(screen.queryByText(/nothing is listening/i)).not.toBeInTheDocument();
  });
});
