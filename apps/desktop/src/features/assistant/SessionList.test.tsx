import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SESSIONS, useChat } from "../../app/chatStore";
import { SessionList } from "./SessionList";

const reset = () =>
  useChat.setState({ sessions: [], activeId: null, busy: false, tools: [], error: null });

describe("SessionList", () => {
  beforeEach(reset);

  it("offers a way to start a conversation when there are none", () => {
    render(<SessionList />);
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();
  });

  it("lists a session by its title", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "why is the build failing");
    render(<SessionList />);

    expect(
      screen.getByRole("button", { name: /^why is the build failing$/i }),
    ).toBeInTheDocument();
  });

  it("marks the active session", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "first");
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "second");
    render(<SessionList />);

    expect(screen.getByRole("button", { name: /^second$/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("switches session on click", async () => {
    const first = useChat.getState().newSession();
    useChat.getState().addTurn("user", "first");
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "second");
    render(<SessionList />);

    await userEvent.setup().click(screen.getByRole("button", { name: /^first$/i }));
    expect(useChat.getState().activeId).toBe(first);
  });

  it("lists the newest first, because that is the one you want", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "older");
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "newer");
    render(<SessionList />);

    const titles = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === "older" || t === "newer");
    expect(titles[0]).toBe("newer");
  });

  it("deletes a session from its own control", async () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "doomed");
    render(<SessionList />);

    await userEvent.setup().click(screen.getByRole("button", { name: /delete doomed/i }));
    expect(useChat.getState().sessions).toHaveLength(0);
  });

  it("says how many conversations are kept", () => {
    // The pruning is surprising if it is never mentioned.
    render(<SessionList />);
    expect(screen.getByText(new RegExp(String(MAX_SESSIONS)))).toBeInTheDocument();
  });

  it("starts a new session from the control", async () => {
    render(<SessionList />);
    await userEvent.setup().click(screen.getByRole("button", { name: /new/i }));
    expect(useChat.getState().sessions).toHaveLength(1);
  });
});
