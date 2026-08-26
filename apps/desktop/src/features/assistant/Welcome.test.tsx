import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Welcome } from "./Welcome";

describe("Welcome", () => {
  it("shows the JKY mark", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByRole("img", { name: /jky/i })).toBeInTheDocument();
  });

  it("offers openings rather than a blank box", () => {
    // A cursor in an empty field is the least helpful possible invitation.
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });

  it("fills the composer when an opening is chosen", async () => {
    const onPick = vi.fn();
    render(<Welcome onPick={onPick} />);

    await userEvent.setup().click(screen.getAllByRole("button")[0]);
    expect(onPick).toHaveBeenCalledWith(expect.any(String));
    expect(onPick.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it("states the safety property, because it is the reassuring part", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByText(/nothing runs until you approve/i)).toBeInTheDocument();
  });

  it("mentions asking from the terminal", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByText(/jky ask/i)).toBeInTheDocument();
  });
});
