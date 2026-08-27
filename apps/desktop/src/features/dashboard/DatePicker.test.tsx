import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

function open(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Date" }));
}

describe("the date picker", () => {
  it("shows the chosen day in words, not as a key", async () => {
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Date" })).toHaveTextContent("Thu 27 Aug 2026");
  });

  it("stays shut until asked", () => {
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on click", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers a close button", async () => {
    // The whole reason this replaced the native picker: nothing could put a
    // close control on that one, because the OS draws it outside the page.
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /close the calendar/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says that Escape works, rather than leaving it to be guessed", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);
    expect(screen.getByText(/press esc to close/i)).toBeInTheDocument();
  });

  it("closes when you click away from it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <DatePicker value="2026-08-27" onChange={() => {}} />
        <button type="button">elsewhere</button>
      </div>,
    );
    await open(user);

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("puts focus back on the field it came from", async () => {
    // Otherwise focus lands on the body and the next Tab restarts from the
    // top of the page.
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Date" })).toHaveFocus(),
    );
  });

  it("hands back the day that was clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-08-27" onChange={onChange} />);
    await open(user);

    await user.click(screen.getByRole("gridcell", { name: "Sat 29 Aug 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-08-29");
  });

  it("shuts itself after a day is chosen", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    await user.click(screen.getByRole("gridcell", { name: "Sat 29 Aug 2026" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens on the month of the day already chosen", async () => {
    // Opening on today would hide the chosen day behind two clicks.
    const user = userEvent.setup();
    render(<DatePicker value="2027-03-14" onChange={() => {}} />);
    await open(user);
    expect(screen.getByRole("grid", { name: "Mar 2027" })).toBeInTheDocument();
  });

  it("pages between months", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("grid", { name: "Sep 2026" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByRole("grid", { name: "Aug 2026" })).toBeInTheDocument();
  });

  it("will not let a day before the minimum be chosen", async () => {
    // Disabling is clearer than accepting the click and refusing on submit.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-08-27" min="2026-08-27" onChange={onChange} />);
    await open(user);

    const earlier = screen.getByRole("gridcell", { name: "Wed 26 Aug 2026" });
    expect(earlier).toBeDisabled();
    await user.click(earlier);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves days on or after the minimum alone", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" min="2026-08-27" onChange={() => {}} />);
    await open(user);

    expect(screen.getByRole("gridcell", { name: "Thu 27 Aug 2026" })).toBeEnabled();
    expect(screen.getByRole("gridcell", { name: "Fri 28 Aug 2026" })).toBeEnabled();
  });

  it("marks which day is currently chosen", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    const chosen = screen.getByRole("gridcell", { name: "Thu 27 Aug 2026" });
    expect(chosen).toHaveAttribute("aria-selected", "true");
  });

  it("walks the grid with the arrow keys", async () => {
    // A calendar grid that only responds to Tab is a calendar grid that
    // takes thirty keystrokes to cross.
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    await open(user);

    const start = screen.getByRole("gridcell", { name: "Thu 27 Aug 2026" });
    start.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "Fri 28 Aug 2026" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("gridcell", { name: "Fri 4 Sep 2026" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("gridcell", { name: "Thu 27 Aug 2026" })).toHaveFocus();
  });

  it("follows a value changed from outside", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    rerender(<DatePicker value="2026-12-25" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Date" })).toHaveTextContent("Fri 25 Dec 2026");
    await open(user);
    expect(screen.getByRole("grid", { name: "Dec 2026" })).toBeInTheDocument();
  });

  it("tells assistive tech whether it is open", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-08-27" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Date" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Date" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows every day of the month it is displaying", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-02-10" onChange={() => {}} />);
    await open(user);

    const grid = screen.getByRole("grid", { name: "Feb 2026" });
    expect(within(grid).getByRole("gridcell", { name: "Sat 28 Feb 2026" })).toBeTruthy();
  });
});
