import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { describeDay } from "./DatePicker";
import { localDate, localTime } from "./eventTime";
import { __setPlatformForTests, createWebPlatform, type Platform } from "../../platform";

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** A web platform whose mail config is already verified and switched on. */
function readyMailPlatform(): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    mail: {
      ...base.mail,
      readConfig: async () => ({
        address: "someone@gmail.com",
        host: "smtp.gmail.com",
        port: 465,
        enabled: true,
        verified_address: "someone@gmail.com",
      }),
    },
  };
}

describe("the event form", () => {
  afterEach(() => __setPlatformForTests(null));


  it("labels the date and time visibly, not only to a screen reader", async () => {
    // Two bare boxes side by side do not say which is which.
    render(<EventForm onAdd={() => {}} />);
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
  });

  it("spells out the moment the two boxes add up to", async () => {
    const { container } = render(<EventForm day="2099-08-27" onAdd={() => {}} />);

    // A wrong month is invisible in a date box and obvious in a sentence.
    // Scoped to the summary line: the trigger button says the day too, which
    // is the point, but this is checking that the summary spells out both
    // halves together.
    const summary = container.querySelector(".eventform__when")!;
    expect(summary.textContent).toMatch(/Thu 27 Aug 2099, \d{2}:\d{2}/);
  });

  it("follows the calendar day it is given", async () => {
    // The bug this replaced: useState reads its argument once, so the form
    // kept whichever day was selected when it mounted and every later click
    // on the calendar did nothing at all.
    const { rerender } = render(<EventForm day="2099-08-27" onAdd={() => {}} />);
    expect(screen.getByRole("button", { name: "Event date" })).toHaveTextContent(
      "Thu 27 Aug 2099",
    );

    rerender(<EventForm day="2099-09-15" onAdd={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Event date" })).toHaveTextContent(
        "Tue 15 Sep 2099",
      ),
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

  it("stops the calendar offering past days at all", async () => {
    // The rule is visible before it is enforced, rather than only after.
    const user = userEvent.setup();
    render(<EventForm onAdd={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Event date" }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(
      screen.getByRole("gridcell", { name: describeDay(localDate(yesterday)) }),
    ).toBeDisabled();
  });

  it("lets the calendar be closed, unlike the native picker", async () => {
    // Why this replaced it: nothing could put a close control on a picker the
    // operating system draws outside the page.
    const user = userEvent.setup();
    render(<EventForm onAdd={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Event date" }));
    expect(screen.getByText(/press esc to close/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close the calendar/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("takes a day chosen from the calendar", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EventForm day={dayOffset(2)} onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: "Event date" }));
    const target = dayOffset(5);
    await user.click(screen.getByRole("gridcell", { name: describeDay(target) }));

    await user.type(screen.getByLabelText("Event title"), "Chosen from the calendar");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    expect(localDate(new Date(onAdd.mock.calls[0][0].starts_at))).toBe(target);
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
    expect(screen.getByRole("button", { name: "Event date" })).toHaveTextContent(
      describeDay(when),
    );
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

  it("keeps the alert field locked until email alerts are verified and on", async () => {
    // The default web platform starts with no mail configured at all.
    __setPlatformForTests(createWebPlatform());
    render(<EventForm onAdd={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText(/email alert/i)).toBeDisabled());
    expect(screen.getByText(/set up email alerts first/i)).toBeInTheDocument();
  });

  it("unlocks the alert field once email alerts are verified and on", async () => {
    __setPlatformForTests(readyMailPlatform());
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EventForm day={dayOffset(2)} onAdd={onAdd} />);

    await waitFor(() => expect(screen.getByLabelText(/email alert/i)).toBeEnabled());
    expect(screen.queryByText(/set up email alerts first/i)).toBeNull();

    await user.type(screen.getByLabelText("Event title"), "Team meeting");
    await user.selectOptions(screen.getByLabelText(/email alert/i), "30");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    expect(onAdd.mock.calls[0][0].alert_minutes_before).toBe(30);
  });
});

