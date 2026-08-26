import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAsk } from "../../app/askStore";
import { useChat } from "../../app/chatStore";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Assistant } from "./Assistant";

describe("Assistant", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    useAsk.setState({ pending: null });
    useChat.setState({
      sessions: [],
      activeId: null,
      busy: false,
      tools: [],
      error: null,
      provider: "openai",
    });
  });
  afterEach(() => __setPlatformForTests(null));

  it("invites the user to ask something", async () => {
    render(<Assistant />);
    expect(await screen.findByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });

  it("says up front that nothing runs without approval", () => {
    // The safety property is only reassuring if the user knows about it.
    render(<Assistant />);
    expect(screen.getByText(/nothing runs until you approve/i)).toBeInTheDocument();
  });

  it("shows what the user asked, attributed to them", async () => {
    const user = userEvent.setup();
    const { container } = render(<Assistant />);

    await user.type(screen.getByRole("textbox", { name: /message/i }), "what is this repo");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Scoped to the user's own turn: the reply echoes the question back, so an
    // unscoped text query matches twice and proves nothing about attribution.
    await waitFor(() =>
      expect(container.querySelector('[data-role="user"]')).toHaveTextContent(
        "what is this repo",
      ),
    );
  });

  it("renders streamed text as it lands in the store", async () => {
    // The subscription lives in App so a stream survives this panel
    // unmounting; here the store is driven directly.
    render(<Assistant />);
    useChat.getState().addTurn("user", "hello");
    useChat.getState().appendToLastAssistant("You said: hello");

    await waitFor(() => expect(screen.getByText(/You said: hello/)).toBeInTheDocument());
  });

  it("keeps the conversation when the panel unmounts and returns", async () => {
    // The bug: switching to the terminal used to throw the answer away.
    const { unmount } = render(<Assistant />);
    useChat.getState().addTurn("user", "remember me");
    unmount();

    const { container } = render(<Assistant />);
    // Scoped to the transcript: the session title in the sidebar is derived
    // from the same first question, so an unscoped query matches twice.
    await waitFor(() =>
      expect(container.querySelector('[data-role="user"]')).toHaveTextContent("remember me"),
    );
  });

  it("collects streamed tokens into one turn rather than one turn per token", async () => {
    render(<Assistant />);
    useChat.getState().addTurn("user", "hello");
    for (const word of ["You ", "said: ", "hello"]) {
      useChat.getState().appendToLastAssistant(word);
    }

    await waitFor(() => expect(screen.getByText(/You said: hello/)).toBeInTheDocument());
    // user turn + assistant turn, not user turn + one per word.
    expect(screen.getAllByText(/^(you|jky)$/)).toHaveLength(2);
  });

  it("shows the backend's own error text rather than a generic one", async () => {
    // Tauri rejects with a plain string. An `instanceof Error` check discards
    // it, which is how a 400 explaining exactly what was wrong became
    // "The request failed."
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      ai: {
        ...platform.ai,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        send: (_provider, _conversation) =>
          Promise.reject("400 Bad Request: max_tokens is too large"),
      },
    });

    const user = userEvent.setup();
    render(<Assistant />);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/max_tokens is too large/);
  });

  it("asks a question raised from a terminal without the user retyping it", async () => {
    // `jky ask what does ls do` in a shell should land here as a real turn.
    const { container } = render(<Assistant />);
    useAsk.getState().ask("what does ls do");

    await waitFor(() =>
      expect(container.querySelector('[data-role="user"]')).toHaveTextContent("what does ls do"),
    );
  });

  it("takes a terminal question exactly once", async () => {
    // Otherwise every re-render would re-ask whatever was asked last.
    const { container } = render(<Assistant />);
    useAsk.getState().ask("hello there");

    await waitFor(() =>
      expect(container.querySelector('[data-role="user"]')).toHaveTextContent("hello there"),
    );
    expect(useAsk.getState().pending).toBeNull();
    expect(container.querySelectorAll('[data-role="user"]')).toHaveLength(1);
  });

  it("will not send an empty message", () => {
    render(<Assistant />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("clears the box after sending so the next message starts fresh", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    const box = screen.getByRole("textbox", { name: /message/i });
    await user.type(box, "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(box).toHaveValue(""));
  });
});
