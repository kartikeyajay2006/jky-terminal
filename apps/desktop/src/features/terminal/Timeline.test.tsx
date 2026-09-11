import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import { MAX_TICK, MIN_TICK, type Tick } from "./ticks";

const tick = (over: Partial<Tick> = {}): Tick => ({
  id: "1",
  command: "ls",
  code: 0,
  took: 120,
  line: 40,
  at: 1_700_000_000_000,
  ...over,
});

const heights = () =>
  screen.getAllByRole("button").map((b) => Number.parseInt(b.style.height, 10));

describe("Timeline", () => {
  it("draws nothing before anything has run", () => {
    const { container } = render(<Timeline ticks={[]} onJump={() => {}} />);
    // Not an empty strip: a column of nothing would still take width from
    // output, on a screen where nothing has happened yet.
    expect(container).toBeEmptyDOMElement();
  });

  it("draws one mark per command", () => {
    render(
      <Timeline
        ticks={[tick({ id: "a" }), tick({ id: "b" }), tick({ id: "c" })]}
        onJump={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("marks a failure apart from a success", () => {
    render(
      <Timeline
        ticks={[tick({ id: "a", code: 0 }), tick({ id: "b", code: 1 })]}
        onJump={() => {}}
      />,
    );
    const [ok, bad] = screen.getAllByRole("button");
    expect(ok).toHaveAttribute("data-tone", "ok");
    expect(bad).toHaveAttribute("data-tone", "failed");
  });

  it("shows a command still going as running", () => {
    render(<Timeline ticks={[tick({ took: null, code: null })]} onJump={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-tone", "running");
  });

  it("draws the long command taller than the short one", () => {
    render(
      <Timeline
        ticks={[tick({ id: "quick", took: 8 }), tick({ id: "build", took: 240_000 })]}
        onJump={() => {}}
      />,
    );
    const [quick, build] = heights();
    expect(build).toBeGreaterThan(quick);
    expect(build).toBe(MAX_TICK);
    // Still drawn, and still big enough to press.
    expect(quick).toBeGreaterThanOrEqual(MIN_TICK);
  });

  it("jumps to the line a command's prompt is on", async () => {
    const jump = vi.fn();
    render(
      <Timeline
        ticks={[tick({ id: "a", line: 12 }), tick({ id: "b", line: 91 })]}
        onJump={jump}
      />,
    );
    await userEvent.click(screen.getAllByRole("button")[1]);
    expect(jump).toHaveBeenCalledWith(91);
  });

  it("says what each mark is, for anyone not reading a shape", () => {
    render(
      <Timeline ticks={[tick({ command: "cargo build", took: 95_000 })]} onJump={() => {}} />,
    );
    // Rounded to the unit a person would use, not the millisecond.
    expect(screen.getByRole("button", { name: /cargo build, 1m 35s/i })).toBeInTheDocument();
  });

  it("is a group of controls, not a list of text", () => {
    render(<Timeline ticks={[tick()]} onJump={() => {}} />);
    // A `listitem` role on a button takes the button role away, leaving
    // something that reads as text and gives no hint it can be pressed.
    expect(screen.getByRole("group", { name: /commands in this session/i })).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
