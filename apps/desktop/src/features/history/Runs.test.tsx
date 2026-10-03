import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Runs } from "./Runs";
import { History } from "./History";
import { getPlatform, type MemoryRun } from "../../platform";
import { useTabs } from "../../app/tabStore";
import { TYPE_EVENT, type TypeRequest } from "../terminal/typeEvent";

const NOW = Date.now();

function run(over: Partial<MemoryRun>): MemoryRun {
  return {
    id: 1,
    command: "cargo build --release",
    cwd: "/home/k/api",
    code: 1,
    at: NOW - 3 * 60_000,
    session: "pane-1",
    host: null,
    duration_ms: 4_200,
    branch: "release",
    rev: "2b20c30",
    output: "Compiling api v0.1.0\nerror: linker `cc` not found",
    pinned: false,
    note: "",
    snippet: null,
    ...over,
  };
}

describe("runs and their output", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("finds a run by a word in what it printed, and marks the match", async () => {
    const search = vi
      .spyOn(getPlatform().memory, "search")
      .mockResolvedValue([run({ snippet: "…error: \u0002linker\u0003 `cc` not found" })]);
    const user = userEvent.setup();
    render(<Runs />);
    await user.type(screen.getByRole("searchbox", { name: /search runs and their output/i }), "linker");
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ text: "linker" })));
    const mark = await screen.findByText("linker", { selector: "mark" });
    expect(mark.closest("p")).toHaveTextContent("error: linker `cc` not found");
  });

  it("says where, on which branch and commit, how it ended and how long it took", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    render(<Runs />);
    const row = await screen.findByRole("listitem");
    expect(row).toHaveTextContent("/home/k/api");
    expect(row).toHaveTextContent("release @ 2b20c30");
    expect(row).toHaveTextContent("exit 1");
    expect(row).toHaveTextContent("4.2s");
  });

  it("shows what a run printed when asked", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    const user = userEvent.setup();
    render(<Runs />);
    await user.click(await screen.findByRole("button", { name: /show output of cargo build/i }));
    expect(screen.getByText(/error: linker `cc` not found/, { selector: "pre" })).toBeInTheDocument();
  });

  it("pins a run, and Rust is told", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    const pin = vi.spyOn(getPlatform().memory, "pin").mockResolvedValue();
    const user = userEvent.setup();
    render(<Runs />);
    await user.click(await screen.findByRole("button", { name: /pin cargo build/i }));
    expect(pin).toHaveBeenCalledWith(1, true);
  });

  it("keeps a note once you leave the field", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    const note = vi.spyOn(getPlatform().memory, "note").mockResolvedValue();
    const user = userEvent.setup();
    render(<Runs />);
    await user.click(await screen.findByRole("button", { name: /show output of cargo build/i }));
    const field = screen.getByRole("textbox", { name: /note on this run/i });
    await user.type(field, "needs the mold linker");
    await user.tab();
    expect(note).toHaveBeenCalledWith(1, "needs the mold linker");
  });

  it("forgets this run only", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    const forget = vi.spyOn(getPlatform().memory, "forget").mockResolvedValue();
    const user = userEvent.setup();
    render(<Runs />);
    await user.click(await screen.findByRole("button", { name: /forget this run of cargo build/i }));
    expect(forget).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());
  });

  it("puts a command back on the prompt, never runs it", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([run({})]);
    useTabs.getState().openTab("terminal", "Terminal 1");
    const typed: TypeRequest[] = [];
    const listen = (e: Event) => typed.push((e as CustomEvent<TypeRequest>).detail);
    window.addEventListener(TYPE_EVENT, listen);
    const user = userEvent.setup();
    render(<Runs />);
    await user.click(await screen.findByRole("button", { name: /^cargo build --release$/ }));
    window.removeEventListener(TYPE_EVENT, listen);
    expect(typed.at(-1)?.text).toBe("cargo build --release");
  });

  it("is a view of the History section", async () => {
    vi.spyOn(getPlatform().memory, "search").mockResolvedValue([]);
    const user = userEvent.setup();
    render(<History />);
    await user.click(screen.getByRole("tab", { name: /runs & output/i }));
    expect(screen.getByRole("searchbox", { name: /search runs and their output/i })).toBeInTheDocument();
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: /runs & output/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
