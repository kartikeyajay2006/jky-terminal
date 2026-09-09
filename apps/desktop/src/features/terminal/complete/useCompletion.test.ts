import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompletion } from "./useCompletion";
import { getPlatform, type Suggestion } from "../../../platform";
import type { TerminalControls } from "../useXterm";

const suggestion = (value: string, from = 0): Suggestion => ({
  value,
  display: value,
  kind: "file",
  detail: "",
  from,
});

/**
 * Let the poll run and any answer land.
 *
 * Wrapped in `act` because the state update happens on a timer rather than
 * in response to anything the test did, and an unwrapped one is a warning
 * that would go on to hide a real one.
 */
const settle = (ms = 200) => act(() => new Promise((r) => setTimeout(r, ms)));

/** A terminal that is only a prompt and a way to replace part of it. */
function fakeTerm(initial: string | null) {
  const state = { text: initial, replaced: [] as Array<[number, number, string]> };
  const term = {
    promptInput: () =>
      state.text === null ? null : { line: state.text, cursor: state.text.length },
    cwd: () => "/home/k",
    replaceRange: (from: number, to: number, text: string) => {
      state.replaced.push([from, to, text]);
    },
    focus: vi.fn(),
    claimKeys: vi.fn(),
  } as unknown as TerminalControls;
  return { term, state };
}

describe("asking for completions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for what is typed, and opens with what came back", async () => {
    const suggest = vi
      .spyOn(getPlatform().complete, "suggest")
      .mockResolvedValue({ start: 4, end: 6, word: "ma", items: [suggestion("main.rs", 4)] });

    const { term } = fakeTerm("cat ma");
    const { result } = renderHook(() => useCompletion(term, true));

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(suggest).toHaveBeenCalledWith("cat ma", 6, "/home/k", 40);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.word).toBe("ma");
  });

  it("never opens on an empty prompt", async () => {
    // A list that appears the moment a prompt does is a list in the way.
    const suggest = vi.spyOn(getPlatform().complete, "suggest");
    const { term } = fakeTerm("   ");
    const { result } = renderHook(() => useCompletion(term, true));

    await settle();
    expect(suggest).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it("asks nothing while a command is running", async () => {
    // No prompt to read means nothing is being typed.
    const suggest = vi.spyOn(getPlatform().complete, "suggest");
    const { term } = fakeTerm(null);
    renderHook(() => useCompletion(term, true));

    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("asks nothing while the pane is not focused", async () => {
    const suggest = vi.spyOn(getPlatform().complete, "suggest");
    const { term } = fakeTerm("cat ma");
    renderHook(() => useCompletion(term, false));

    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("asks once for text that has not changed", async () => {
    const suggest = vi
      .spyOn(getPlatform().complete, "suggest")
      .mockResolvedValue({ start: 0, end: 6, word: "ma", items: [suggestion("main.rs")] });

    const { term } = fakeTerm("cat ma");
    renderHook(() => useCompletion(term, true));

    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
    await settle(250);
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it("closes when nothing came back rather than showing an empty list", async () => {
    vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
      start: 0,
      end: 3,
      word: "zzz",
      items: [],
    });
    const { term } = fakeTerm("zzz");
    const { result } = renderHook(() => useCompletion(term, true));

    await settle();
    expect(result.current.open).toBe(false);
  });

  it("closes rather than reporting a failure at a prompt", async () => {
    vi.spyOn(getPlatform().complete, "suggest").mockRejectedValue(new Error("nope"));
    const { term } = fakeTerm("cat ma");
    const { result } = renderHook(() => useCompletion(term, true));

    await settle();
    expect(result.current.open).toBe(false);
  });

  it("ignores an answer overtaken by a newer keystroke", async () => {
    // Drawing it would answer a question no longer on screen.
    let releaseFirst: ((v: never) => void) | null = null;
    const slow = new Promise((resolve) => {
      releaseFirst = resolve as never;
    });

    const suggest = vi.spyOn(getPlatform().complete, "suggest");
    suggest.mockReturnValueOnce(slow as never);
    suggest.mockResolvedValue({ start: 0, end: 4, word: "made", items: [suggestion("made-up")] });

    const { term, state } = fakeTerm("ma");
    const { result } = renderHook(() => useCompletion(term, true));

    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
    state.text = "made";
    await waitFor(() => expect(result.current.items[0]?.value).toBe("made-up"));

    releaseFirst!({ start: 0, end: 2, word: "ma", items: [suggestion("stale")] } as never);
    await settle(120);
    expect(result.current.items[0]?.value).toBe("made-up");
  });
});

describe("using a completion", () => {
  it("replaces from where the suggestion says, not from the word", async () => {
    // A line recalled from history replaces the whole command.
    vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
      start: 7,
      end: 8,
      word: "r",
      items: [suggestion("docker run --rm node", 0)],
    });

    const { term, state } = fakeTerm("docker r");
    const { result } = renderHook(() => useCompletion(term, true));
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.accept());
    expect(state.replaced).toEqual([[0, 8, "docker run --rm node"]]);
    expect(result.current.open).toBe(false);
  });

  it("walks the list and wraps at both ends", async () => {
    vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
      start: 0,
      end: 1,
      word: "a",
      items: [suggestion("a"), suggestion("b"), suggestion("c")],
    });
    const { term } = fakeTerm("a");
    const { result } = renderHook(() => useCompletion(term, true));
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.move(1));
    expect(result.current.index).toBe(1);
    act(() => result.current.move(-1));
    expect(result.current.index).toBe(0);
    act(() => result.current.move(-1));
    expect(result.current.index).toBe(2);
  });

  it("stays dismissed until the prompt changes", async () => {
    // An Escape that reopened on the next poll would be a key that does
    // nothing.
    vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
      start: 0,
      end: 6,
      word: "ma",
      items: [suggestion("main.rs")],
    });

    const { term, state } = fakeTerm("cat ma");
    const { result } = renderHook(() => useCompletion(term, true));
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);

    await settle();
    expect(result.current.open).toBe(false);

    state.text = "cat mai";
    await waitFor(() => expect(result.current.open).toBe(true));
  });
});
