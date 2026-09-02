import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRegex } from "./useRegex";
import type { RegexResult } from "./regexEngine";

/** A worker that answers when told to, and records being terminated. */
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<RegexResult>) => void) | null = null;
  posted: unknown[] = [];
  terminated = 0;

  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  terminate() {
    this.terminated += 1;
  }
  answer(result: RegexResult) {
    this.onmessage?.({ data: result } as MessageEvent<RegexResult>);
  }
}

const newest = () => FakeWorker.made[FakeWorker.made.length - 1];
const make = () => new FakeWorker() as unknown as Worker;

describe("useRegex", () => {
  beforeEach(() => {
    FakeWorker.made = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("sends the pattern to the worker", async () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("a+", "g", "aaa"));

    expect(newest().posted).toEqual([{ pattern: "a+", flags: "g", text: "aaa" }]);
    expect(result.current.busy).toBe(true);
  });

  it("gives back what the worker answered", () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("a", "g", "aaa"));
    act(() => newest().answer({ ok: true, matches: [], truncated: false }));

    // Asserted directly rather than with `waitFor`: the worker's answer lands
    // synchronously inside `act`, and `waitFor` under fake timers waits on a
    // clock nothing is advancing.
    expect(result.current.busy).toBe(false);
    expect(result.current.result).toEqual({ ok: true, matches: [], truncated: false });
  });

  /*
   * The reason a worker exists at all.
   *
   * `(a+)+$` against a long run of a's takes longer than the universe. On the
   * main thread that is a frozen window with no way out; here the worker is
   * terminated and the tool says so. Nothing else can stop a regular
   * expression once it has started.
   */
  it("kills a pattern that will not finish, and says so", async () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("(a+)+$", "", "a".repeat(40) + "!"));
    const worker = newest();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(worker.terminated).toBe(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.result).toMatchObject({ ok: false });
    if (result.current.result && !result.current.result.ok) {
      expect(result.current.result.message).toMatch(/too long|gave up|stopped/i);
    }
  });

  // A killed worker cannot be reused, so the next run needs a new one.
  it("starts a fresh worker after killing one", async () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("(a+)+$", "", "aaaa!"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    act(() => result.current.run("b", "g", "abc"));
    expect(FakeWorker.made).toHaveLength(2);
    expect(newest().posted).toHaveLength(1);
  });

  // An answer that arrives after the timeout belongs to a run nobody is
  // waiting for any more.
  it("ignores an answer from a worker it already gave up on", async () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("a", "g", "aaa"));
    const worker = newest();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    act(() => worker.answer({ ok: true, matches: [], truncated: false }));

    expect(result.current.result).toMatchObject({ ok: false });
  });

  it("stops the worker when it goes away", async () => {
    const { result, unmount } = renderHook(() => useRegex(make));
    act(() => result.current.run("a", "g", "aaa"));
    const worker = newest();

    unmount();
    expect(worker.terminated).toBe(1);
  });

  // Nothing typed is not a question, and asking it would flash a result.
  it("does not run an empty pattern", () => {
    const { result } = renderHook(() => useRegex(make));
    act(() => result.current.run("", "g", "aaa"));
    expect(FakeWorker.made).toHaveLength(0);
    expect(result.current.result).toBeNull();
  });
});
