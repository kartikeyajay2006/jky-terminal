import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypewriter } from "./useTypewriter";

function Typed({ text, enabled }: { text: string; enabled?: boolean }) {
  return <p data-testid="out">{useTypewriter(text, enabled)}</p>;
}

const out = () => screen.getByTestId("out").textContent ?? "";

function prefersReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prefersReducedMotion(false);
  });
  afterEach(() => vi.useRealTimers());

  it("arrives a piece at a time and ends with all of it", () => {
    render(<Typed text="fatal: non-fast-forward" />);
    expect(out()).toBe("");

    act(() => void vi.advanceTimersByTime(32));
    const part = out();
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThan("fatal: non-fast-forward".length);

    act(() => void vi.advanceTimersByTime(2000));
    expect(out()).toBe("fatal: non-fast-forward");
  });

  /*
   * A long answer takes about as long as a short one.
   *
   * One character per tick is fine for a sentence and a wait for a page —
   * and the effect is meant to say "this is arriving", not to be sat through.
   */
  it("takes about as long whatever the length", () => {
    const long = "x".repeat(4000);
    render(<Typed text={long} />);
    act(() => void vi.advanceTimersByTime(600));
    expect(out()).toBe(long);
  });

  /*
   * Someone who asked their system for less motion should see the answer,
   * not watch it. This is motion in the strictest sense — text moving.
   */
  it("shows the whole answer at once for anyone who asked for less motion", () => {
    prefersReducedMotion(true);
    render(<Typed text="all of it" />);
    expect(out()).toBe("all of it");
  });

  it("can be turned off by the caller", () => {
    render(<Typed text="immediately" enabled={false} />);
    expect(out()).toBe("immediately");
  });

  it("starts again when the text changes", () => {
    const { rerender } = render(<Typed text="first" />);
    act(() => void vi.advanceTimersByTime(2000));
    expect(out()).toBe("first");

    rerender(<Typed text="second answer" />);
    expect(out()).toBe("");
    act(() => void vi.advanceTimersByTime(2000));
    expect(out()).toBe("second answer");
  });

  it("handles having nothing to type", () => {
    render(<Typed text="" />);
    act(() => void vi.advanceTimersByTime(100));
    expect(out()).toBe("");
  });

  // An interval left running after the component goes is a timer firing into
  // nothing for the life of the app.
  it("stops when it goes away", () => {
    const view = render(<Typed text={"y".repeat(500)} />);
    view.unmount();
    expect(() => act(() => void vi.advanceTimersByTime(5000))).not.toThrow();
  });
});
