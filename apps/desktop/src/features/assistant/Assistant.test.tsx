import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Assistant } from "./Assistant";

describe("Assistant", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
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

  it("streams the reply in as it arrives", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    await user.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText(/You said: hello/)).toBeInTheDocument());
  });

  it("collects streamed tokens into one turn rather than one turn per token", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    await user.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

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
