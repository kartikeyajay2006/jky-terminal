import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { localDate, localTime } from "./eventTime";

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
}

describe("the event form", () => {
  it("labels the date and time visibly, not only to a screen reader", async () => {
    // Two bare boxes side by side do not say which is which.
    render(<EventForm onAdd={() => {}} />);
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
  });

  it("spells out the moment the two boxes add up to", async () => {
    const user = userEvent.setup();
    render(<EventForm onAdd={() => {}} />);

    const date = screen.getByLabelText("Event date");
    await user.clear(date);
    await user.type(date, "2099-08-27");

    // A wrong month is invisible in a date box and obvious in a sentence.
    expect(await screen.findByText(/Thu 27 Aug 2099/)).toBeInTheDocument();
  });

  it("follows the calendar day it is given", async () => {
    // The bug this replaced: useState reads its argument once, so the form
    // kept whichever day was selected when it mounted and every later click
    // on the calendar did nothing at all.
    const { rerender } = render(<EventForm day="2099-08-27" onAdd={() => {}} />);
    expect(screen.getByLabelText("Event date")).toHaveValue("2099-08-27");

    rerender(<EventForm day="2099-09-15" onAdd={() => {}} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Event date")).toHaveValue("2099-09-15"),
    );
  });

  it("will not arrange a meeting for a day that has gone", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EventForm day={dayOffset(-3)} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Event title"), "Yesterday's meeting");
    expect(screen.getByRole("button", { name: /add event/i })).toBeDisabled();
    expect(screen.getByText(/already passed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add event/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("stops the picker offering past days at all", () => {
    // The rule is visible before it is enforced, rather than only after.
    render(<EventForm onAdd={() => {}} />);
    expect(screen.getByLabelText("Event date")).toHaveAttribute("min", localDate(new Date()));
  });

  it("refuses a time earlier today, not just an earlier day", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EventForm day={localDate(new Date())} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Event title"), "This morning");
    const time = screen.getByLabelText("Event time");
    await user.clear(time);
    await user.type(time, "00:01");

    expect(screen.getByRole("button", { name: /add event/i })).toBeDisabled();
  });

  it("adds an event that is still to come", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EventForm day={dayOffset(2)} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Event title"), "Team meeting");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const event = onAdd.mock.calls[0][0];
    expect(event.title).toBe("Team meeting");
    expect(event.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("stores the instant the person actually chose", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const when = dayOffset(2);
    render(<EventForm day={when} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Event title"), "Review");
    const time = screen.getByLabelText("Event time");
    await user.clear(time);
    await user.type(time, "14:30");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    // Round-tripped back to the local clock, it is the same wall-clock time.
    const stored = new Date(onAdd.mock.calls[0][0].starts_at);
    expect(localTime(stored)).toBe("14:30");
    expect(localDate(stored)).toBe(when);
  });

  it("clears the title after adding, and keeps the date", async () => {
    // Adding three things to the same day should not mean re-picking it.
    const user = userEvent.setup();
    const when = dayOffset(2);
    render(<EventForm day={when} onAdd={() => {}} />);

    await user.type(screen.getByLabelText("Event title"), "First");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    expect(screen.getByLabelText("Event title")).toHaveValue("");
    expect(screen.getByLabelText("Event date")).toHaveValue(when);
  });

  it("will not add an event with no title", async () => {
    render(<EventForm day={dayOffset(2)} onAdd={() => {}} />);
    expect(screen.getByRole("button", { name: /add event/i })).toBeDisabled();
  });

  it("says what the alert options mean rather than just a number", async () => {
    render(<EventForm onAdd={() => {}} />);
    expect(screen.getByRole("option", { name: /email 30 min before/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /no email alert/i })).toBeTruthy();
  });
});

