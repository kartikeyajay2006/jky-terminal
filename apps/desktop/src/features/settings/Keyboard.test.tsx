import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Keyboard } from "./Keyboard";
import { useKeymap } from "../../app/keymapStore";
import { defaultKeyboard } from "../../platform/keymap";

function reseed() {
  const board = defaultKeyboard();
  useKeymap.setState({
    bindings: board.bindings,
    conflicts: [],
    byChord: new Map(board.bindings.map((b) => [b.chord, b.action])),
    error: null,
  });
}

const chordButton = (label: string) =>
  screen.getByRole("button", { name: new RegExp(`^${label}:`) });

describe("the keyboard panel", () => {
  beforeEach(async () => {
    reseed();
    await useKeymap.getState().resetAll();
    reseed();
  });

  it("lists every shortcut, grouped", () => {
    expect(screen.queryByText("Panes")).toBeNull();
    render(<Keyboard />);
    expect(screen.getByText("Panes")).toBeInTheDocument();
    expect(chordButton("Split right")).toHaveTextContent("Ctrl+Shift+D");
  });

  it("takes a new binding by listening rather than by being typed", async () => {
    // Typing `Ctrl+Alt+2` into a box means agreeing with the app about how a
    // chord is spelled, and a mistake there is a shortcut that never fires.
    const user = userEvent.setup();
    render(<Keyboard />);

    await user.click(chordButton("Split right"));
    expect(screen.getByText("press keys…")).toBeInTheDocument();

    await user.keyboard("{Control>}{Alt>}2{/Alt}{/Control}");
    await waitFor(() => expect(chordButton("Split right")).toHaveTextContent("Ctrl+Alt+2"));
  });

  it("says why a refused binding was refused, and changes nothing", async () => {
    const user = userEvent.setup();
    render(<Keyboard />);

    await user.click(chordButton("Split right"));
    await user.keyboard("{Control>}t{/Control}");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already/i));
    expect(chordButton("Split right")).toHaveTextContent("Ctrl+Shift+D");
  });

  it("leaves a shortcut alone when the capture is escaped", async () => {
    const user = userEvent.setup();
    render(<Keyboard />);

    await user.click(chordButton("Close pane"));
    await user.keyboard("{Escape}");

    expect(chordButton("Close pane")).toHaveTextContent("Ctrl+Shift+W");
  });

  it("offers a reset only on a shortcut that was changed", async () => {
    const user = userEvent.setup();
    render(<Keyboard />);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    await user.click(chordButton("Split right"));
    await user.keyboard("{Control>}{Alt>}2{/Alt}{/Control}");

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(chordButton("Split right")).toHaveTextContent("Ctrl+Shift+D"));
  });

  it("warns when a hand-edited keymap binds one chord twice", () => {
    useKeymap.setState({
      conflicts: [{ chord: "Ctrl+J", actions: ["New terminal tab", "Close tab"] }],
    });
    render(<Keyboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ctrl+J runs both");
  });

  it("falls back to the defaults, and says so, when the keymap cannot be read", () => {
    useKeymap.setState({ error: "disk on fire" });
    render(<Keyboard />);
    expect(screen.getByRole("status")).toHaveTextContent("disk on fire");
    expect(chordButton("Split right")).toHaveTextContent("Ctrl+Shift+D");
  });
});
