import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SESSIONS, useChat } from "./chatStore";

const reset = () =>
  useChat.setState({ sessions: [], activeId: null, busy: false, tools: [], error: null });

describe("chatStore", () => {
  beforeEach(reset);

  it("starts with no sessions", () => {
    expect(useChat.getState().sessions).toEqual([]);
  });

  it("creates a session and makes it active", () => {
    const id = useChat.getState().newSession();
    expect(useChat.getState().activeId).toBe(id);
    expect(useChat.getState().sessions).toHaveLength(1);
  });

  it("keeps turns when a session is not the active one", () => {
    // The bug this store exists to fix: switching away must not lose anything.
    const first = useChat.getState().newSession();
    useChat.getState().addTurn("user", "hello");
    const second = useChat.getState().newSession();
    useChat.getState().switchTo(first);

    expect(useChat.getState().sessions.find((s) => s.id === first)!.turns).toHaveLength(1);
    expect(second).not.toBe(first);
  });

  it("appends streamed text to the open assistant turn", () => {
    useChat.getState().newSession();
    useChat.getState().appendToLastAssistant("Hel");
    useChat.getState().appendToLastAssistant("lo");

    const turns = useChat.getState().sessions[0].turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Hello");
  });

  it("titles a session from its first question", () => {
    // "Session 3" tells you nothing when you are looking for one of five.
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "why does the build fail on windows");
    expect(useChat.getState().sessions[0].title).toMatch(/why does the build/i);
  });

  it("keeps the title from the first question, not the latest", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "the first question");
    useChat.getState().addTurn("user", "a later one");
    expect(useChat.getState().sessions[0].title).toMatch(/first question/i);
  });

  it("shortens a long title rather than letting it run", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "x".repeat(200));
    expect(useChat.getState().sessions[0].title.length).toBeLessThanOrEqual(60);
  });

  it(`keeps at most ${MAX_SESSIONS} sessions`, () => {
    for (let i = 0; i < MAX_SESSIONS + 3; i++) useChat.getState().newSession();
    expect(useChat.getState().sessions).toHaveLength(MAX_SESSIONS);
  });

  it("prunes the oldest session, not the newest", () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_SESSIONS + 1; i++) ids.push(useChat.getState().newSession());

    const kept = useChat.getState().sessions.map((s) => s.id);
    expect(kept).not.toContain(ids[0]);
    expect(kept).toContain(ids[ids.length - 1]);
  });

  it("deletes a session on request", () => {
    const a = useChat.getState().newSession();
    const b = useChat.getState().newSession();
    useChat.getState().deleteSession(a);

    expect(useChat.getState().sessions.map((s) => s.id)).toEqual([b]);
  });

  it("moves to another session when the active one is deleted", () => {
    const a = useChat.getState().newSession();
    const b = useChat.getState().newSession();
    useChat.getState().deleteSession(b);
    expect(useChat.getState().activeId).toBe(a);
  });

  it("clears the active id when the last session is deleted", () => {
    const only = useChat.getState().newSession();
    useChat.getState().deleteSession(only);
    expect(useChat.getState().activeId).toBeNull();
  });

  it("ignores a delete for a session that is not there", () => {
    const a = useChat.getState().newSession();
    useChat.getState().deleteSession("never-existed");
    expect(useChat.getState().sessions.map((s) => s.id)).toEqual([a]);
  });

  it("holds tool requests so switching away does not lose them", () => {
    const request = {
      id: "t1",
      name: "run_command",
      command: "cargo test",
      reason: "check",
      destructive: false,
    };
    useChat.getState().addTool(request);
    expect(useChat.getState().tools).toHaveLength(1);
  });

  it("ignores a duplicate tool request", () => {
    // A re-emitted event would otherwise stack two identical approval cards.
    const request = {
      id: "t1",
      name: "run_command",
      command: "cargo test",
      reason: "check",
      destructive: false,
    };
    useChat.getState().addTool(request);
    useChat.getState().addTool(request);
    expect(useChat.getState().tools).toHaveLength(1);
  });

  it("clears a tool request once it is decided", () => {
    useChat.getState().addTool({
      id: "t1",
      name: "run_command",
      command: "cargo test",
      reason: "check",
      destructive: false,
    });
    useChat.getState().clearTool("t1");
    expect(useChat.getState().tools).toHaveLength(0);
  });

  it("starts a session on the first turn if none is open", () => {
    // Asking a question should not require choosing to start a session first.
    useChat.getState().addTurn("user", "hello");
    expect(useChat.getState().sessions).toHaveLength(1);
  });
});
