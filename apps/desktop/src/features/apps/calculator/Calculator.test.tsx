import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Calculator } from "./Calculator";

function expression() {
  return screen.getByRole("textbox", { name: /expression/i });
}

describe("Calculator", () => {
  // Opening the app and typing should just work. Without focus, the first
  // keystrokes go nowhere and the calculator reads as accepting mouse only.
  it("puts the cursor in the field so you can type straight away", () => {
    render(<Calculator />);
    expect(expression()).toHaveFocus();
  });

  // Mixing the two is normal: a couple of taps, then the rest typed. Focus
  // has to come back or the typing is lost.
  it("returns the cursor to the field after a keypad press", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.click(screen.getByRole("button", { name: "7" }));
    expect(expression()).toHaveFocus();

    await user.keyboard("+3");
    expect(expression()).toHaveValue("7+3");
  });

  it("keeps the cursor in the field after a calculation is committed", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.click(screen.getByRole("button", { name: /equals/i }));
    expect(expression()).toHaveFocus();
  });

  it("starts with an empty expression and no answer", () => {
    render(<Calculator />);
    expect(expression()).toHaveValue("");
    expect(screen.queryByRole("status")).toHaveTextContent("");
  });

  it("previews the answer as the expression is typed", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "2+3");
    expect(screen.getByRole("status")).toHaveTextContent("5");
  });

  it("says what is wrong rather than showing a wrong answer", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "1/0");
    expect(screen.getByRole("status")).toHaveTextContent(/cannot divide by zero/i);
  });

  it("appends the keypad key that was pressed", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.click(screen.getByRole("button", { name: "7" }));
    await user.click(screen.getByRole("button", { name: /multiply/i }));
    await user.click(screen.getByRole("button", { name: "6" }));
    expect(expression()).toHaveValue("7*6");
    expect(screen.getByRole("status")).toHaveTextContent("42");
  });

  it("clears the expression", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "123");
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(expression()).toHaveValue("");
  });

  it("deletes the last character", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "123");
    await user.click(screen.getByRole("button", { name: /backspace/i }));
    expect(expression()).toHaveValue("12");
  });

  it("keeps a finished calculation in the history", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "8*8{Enter}");
    const history = screen.getByRole("list", { name: /history/i });
    expect(within(history).getByText(/8\*8/)).toBeInTheDocument();
    expect(within(history).getByText("64")).toBeInTheDocument();
  });

  it("clears the expression once it has been kept, ready for the next one", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "8*8{Enter}");
    expect(expression()).toHaveValue("");
  });

  // Committing an error would fill the history with things that never had an
  // answer, and the point of the history is that every line in it is a result.
  it("does not keep an expression that has no answer", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "2+{Enter}");
    expect(screen.queryByRole("list", { name: /history/i })).not.toBeInTheDocument();
    expect(expression()).toHaveValue("2+");
  });

  it("puts a past result back into the expression when it is clicked", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "8*8{Enter}");
    const history = screen.getByRole("list", { name: /history/i });
    await user.click(within(history).getByRole("button", { name: /8\*8/ }));
    expect(expression()).toHaveValue("64");
  });

  it("shows the newest calculation first", async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.type(expression(), "1+1{Enter}");
    await user.type(expression(), "2+2{Enter}");
    const entries = within(screen.getByRole("list", { name: /history/i })).getAllByRole(
      "listitem",
    );
    expect(entries[0]).toHaveTextContent("2+2");
  });
});
