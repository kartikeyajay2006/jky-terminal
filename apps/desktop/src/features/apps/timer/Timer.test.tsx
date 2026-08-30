import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "./Timer";

/*
 * These use `fireEvent` rather than `userEvent`, which every other component
 * test in the app prefers. A timer has to be tested against a clock the test
 * controls — waiting out five real minutes is not a test — and `userEvent`
 * deadlocks under `vi.useFakeTimers()`: it awaits its own internal timers,
 * which only advance when the test advances them, which it cannot do while
 * awaiting. `delay: null` and the documented `advanceTimers` option were both
 * tried and neither breaks the cycle. `fireEvent` is synchronous and has no
 * such loop, and the interactions here are plain clicks and typing, which it
 * dispatches faithfully.
 */

function display() {
  return screen.getByLabelText(/time remaining/i);
}

function click(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function typeDuration(text: string) {
  const input = screen.getByRole("textbox", { name: /set a time/i });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers a duration before anything is running", () => {
    render(<Timer />);
    expect(display()).toHaveTextContent("05:00");
  });

  it("sets the duration from a preset", () => {
    render(<Timer />);
    click(/^10 minutes$/i);
    expect(display()).toHaveTextContent("10:00");
  });

  it("counts down once started", () => {
    render(<Timer />);
    click(/^start$/i);
    tick(3000);
    expect(display()).toHaveTextContent("04:57");
  });

  it("holds the clock while paused", () => {
    render(<Timer />);
    click(/^start$/i);
    tick(3000);
    click(/^pause$/i);
    tick(60_000);
    expect(display()).toHaveTextContent("04:57");
  });

  it("carries on from where it was paused", () => {
    render(<Timer />);
    click(/^start$/i);
    tick(3000);
    click(/^pause$/i);
    click(/^start$/i);
    tick(2000);
    expect(display()).toHaveTextContent("04:55");
  });

  it("puts the clock back on reset", () => {
    render(<Timer />);
    click(/^start$/i);
    tick(30_000);
    click(/^reset$/i);
    expect(display()).toHaveTextContent("05:00");
  });

  it("says when the time is up", () => {
    render(<Timer />);
    click(/^1 minute$/i);
    click(/^start$/i);
    tick(60_000);
    expect(screen.getByRole("alert")).toHaveTextContent(/time.s up/i);
  });

  it("does not run past zero", () => {
    render(<Timer />);
    click(/^1 minute$/i);
    click(/^start$/i);
    tick(90_000);
    expect(display()).toHaveTextContent("00:00");
  });

  it("takes a duration typed as minutes and seconds", () => {
    render(<Timer />);
    typeDuration("2:30");
    expect(display()).toHaveTextContent("02:30");
  });

  it("says so rather than setting a time it could not read", () => {
    render(<Timer />);
    typeDuration("later");
    expect(screen.getByText(/minutes, or mm:ss/i)).toBeInTheDocument();
    expect(display()).toHaveTextContent("05:00");
  });

  // Starting a timer that is already finished should run it again, not sit
  // there showing "time's up" while the button says Start.
  it("runs afresh when started after finishing", () => {
    render(<Timer />);
    click(/^1 minute$/i);
    click(/^start$/i);
    tick(60_000);
    click(/^start$/i);
    tick(1000);
    expect(display()).toHaveTextContent("00:59");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // The repaint is what wakes the machine four times a second; a timer that is
  // not running has nothing to repaint, and one left ticking on a finished
  // clock would keep doing it for as long as the app stayed open.
  it("stops repainting once it is not running", () => {
    render(<Timer />);
    click(/^1 minute$/i);
    click(/^start$/i);
    tick(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
