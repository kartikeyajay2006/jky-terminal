import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLivePanel } from "./useLivePanel";
import { getPlatform } from "../../platform";

const DF = "df -h";

describe("keeping a panel current", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("offers itself only for a command that can be run again", () => {
    expect(renderHook(() => useLivePanel(DF, true)).result.current.source).toBe("df");
    expect(renderHook(() => useLivePanel("ls -l", true)).result.current.source).toBeNull();
  });

  it("runs nothing until it is asked to", async () => {
    // A terminal that started running things on a timer because you typed
    // `df` would be one you had to be careful in.
    const run = vi.spyOn(getPlatform().live, "run");
    renderHook(() => useLivePanel(DF, true));

    await new Promise((r) => setTimeout(r, 60));
    expect(run).not.toHaveBeenCalled();
  });

  it("re-runs the command and re-parses the answer once it is", async () => {
    const run = vi.spyOn(getPlatform().live, "run");
    const { result } = renderHook(() => useLivePanel(DF, true));

    act(() => result.current.toggle());
    await waitFor(() => expect(run).toHaveBeenCalledWith("df"));
    await waitFor(() => expect(result.current.fresh).not.toBeNull());
    expect(result.current.at).not.toBeNull();
  });

  it("runs nothing while the pane is not being looked at", async () => {
    // A panel behind a tab nobody is looking at should not be running a
    // command every two seconds.
    const run = vi.spyOn(getPlatform().live, "run");
    const { result } = renderHook(() => useLivePanel(DF, false));

    act(() => result.current.toggle());
    await new Promise((r) => setTimeout(r, 60));
    expect(run).not.toHaveBeenCalled();
  });

  it("stops on the first refusal rather than retrying for ever", async () => {
    // A command that has started failing will keep failing.
    vi.spyOn(getPlatform().live, "run").mockRejectedValue(new Error("no such thing"));
    const { result } = renderHook(() => useLivePanel(DF, true));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.error).toContain("no such thing"));
    expect(result.current.on).toBe(false);
  });

  it("stops when the command itself refused, and says which", async () => {
    vi.spyOn(getPlatform().live, "run").mockResolvedValue({
      text: "Cannot connect to the Docker daemon\nis it running?",
      code: 1,
    });
    const { result } = renderHook(() => useLivePanel("docker ps", true));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.on).toBe(false));
    expect(result.current.error).toBe("Cannot connect to the Docker daemon");
  });

  it("stops when the output stops looking like what it was", async () => {
    // Rather than showing nothing: output that no longer parses is a reason
    // to stop, not a reason to blank the panel.
    vi.spyOn(getPlatform().live, "run").mockResolvedValue({ text: "not a table at all", code: 0 });
    const { result } = renderHook(() => useLivePanel(DF, true));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.on).toBe(false));
    expect(result.current.error).toContain("stopped looking like");
  });

  it("turns itself off when the command changes", async () => {
    const { result, rerender } = renderHook(({ c }) => useLivePanel(c, true), {
      initialProps: { c: DF },
    });
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.on).toBe(true));

    rerender({ c: "ls -l" });
    await waitFor(() => expect(result.current.on).toBe(false));
    expect(result.current.fresh).toBeNull();
  });
});
