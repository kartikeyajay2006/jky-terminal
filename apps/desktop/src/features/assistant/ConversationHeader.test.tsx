import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useChat } from "../../app/chatStore";
import { ConversationHeader } from "./ConversationHeader";

const reset = () =>
  useChat.setState({ sessions: [], activeId: null, busy: false, tools: [], error: null });

function withConversation(question = "why is the build failing") {
  useChat.getState().newSession();
  useChat.getState().addTurn("user", question);
  useChat.getState().appendToLastAssistant("because of X");
}

describe("ConversationHeader", () => {
  beforeEach(reset);

  it("shows nothing when no conversation is open", () => {
    const { container } = render(<ConversationHeader />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the conversation", () => {
    withConversation();
    render(<ConversationHeader />);
    expect(screen.getByText(/why is the build failing/i)).toBeInTheDocument();
  });

  it("does not delete on the first click", async () => {
    // A conversation is cheap to lose and annoying to lose by accident.
    withConversation();
    render(<ConversationHeader />);

    await userEvent.setup().click(screen.getByRole("button", { name: /delete conversation/i }));
    expect(useChat.getState().sessions).toHaveLength(1);
    expect(screen.getByText(/delete this conversation\?/i)).toBeInTheDocument();
  });

  it("deletes on confirmation", async () => {
    withConversation();
    render(<ConversationHeader />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /delete conversation/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(useChat.getState().sessions).toHaveLength(0);
  });

  it("backs out of a delete", async () => {
    withConversation();
    render(<ConversationHeader />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /delete conversation/i }));
    await user.click(screen.getByRole("button", { name: /keep/i }));

    expect(useChat.getState().sessions).toHaveLength(1);
    expect(screen.queryByText(/delete this conversation\?/i)).not.toBeInTheDocument();
  });

  it("empties a conversation without removing it", async () => {
    withConversation();
    render(<ConversationHeader />);

    await userEvent.setup().click(screen.getByRole("button", { name: /clear/i }));
    expect(useChat.getState().sessions).toHaveLength(1);
    expect(useChat.getState().sessions[0].turns).toHaveLength(0);
  });

  it("renames a cleared conversation, since its title no longer describes it", async () => {
    withConversation();
    render(<ConversationHeader />);

    await userEvent.setup().click(screen.getByRole("button", { name: /clear/i }));
    expect(useChat.getState().sessions[0].title).not.toMatch(/build failing/i);
  });

  it("offers no clear on an already-empty conversation", () => {
    useChat.getState().newSession();
    render(<ConversationHeader />);
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("disarms a pending delete when the conversation changes", async () => {
    // Arming a delete then switching must not leave the new one armed.
    withConversation("first");
    const { rerender } = render(<ConversationHeader />);
    await userEvent.setup().click(screen.getByRole("button", { name: /delete conversation/i }));

    useChat.getState().newSession();
    useChat.getState().addTurn("user", "second");
    rerender(<ConversationHeader />);

    expect(screen.queryByText(/delete this conversation\?/i)).not.toBeInTheDocument();
  });
});
