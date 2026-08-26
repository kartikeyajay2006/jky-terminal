import { beforeEach, describe, expect, it } from "vitest";
import { ASK_PREFIX, decodeAskPayload, useAsk } from "./askStore";

const encode = (text: string) =>
  ASK_PREFIX + btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe("decodeAskPayload", () => {
  it("decodes a question the shell command emitted", () => {
    expect(decodeAskPayload(encode("what does ls do"))).toBe("what does ls do");
  });

  it("survives quotes and newlines in the question", () => {
    // The reason the payload is base64 rather than raw: none of these can
    // break out of the escape sequence.
    const awkward = 'why does "ls -la"\nshow hidden files?';
    expect(decodeAskPayload(encode(awkward))).toBe(awkward);
  });

  it("handles non-ASCII", () => {
    expect(decodeAskPayload(encode("qué hace ls · 説明"))).toBe("qué hace ls · 説明");
  });

  it("ignores an OSC payload that is not ours", () => {
    // OSC 1337 is a shared, application-defined space. Other programs use it.
    expect(decodeAskPayload("SetMark")).toBeNull();
    expect(decodeAskPayload("CurrentDir=/home/x")).toBeNull();
  });

  it("ignores an undecodable payload rather than showing garbage", () => {
    expect(decodeAskPayload(`${ASK_PREFIX}!!!not-base64!!!`)).toBeNull();
  });

  it("ignores an empty question", () => {
    expect(decodeAskPayload(ASK_PREFIX)).toBeNull();
    expect(decodeAskPayload(encode("   "))).toBeNull();
  });
});

describe("useAsk", () => {
  beforeEach(() => useAsk.setState({ pending: null }));

  it("starts with nothing pending", () => {
    expect(useAsk.getState().pending).toBeNull();
  });

  it("holds a question until it is taken", () => {
    useAsk.getState().ask("what does ls do");
    expect(useAsk.getState().pending).toBe("what does ls do");
  });

  it("yields a question exactly once", () => {
    // Otherwise switching tabs would re-ask whatever was last asked.
    useAsk.getState().ask("hello");
    expect(useAsk.getState().take()).toBe("hello");
    expect(useAsk.getState().take()).toBeNull();
  });

  it("trims the question", () => {
    useAsk.getState().ask("  spaced out  ");
    expect(useAsk.getState().pending).toBe("spaced out");
  });

  it("ignores a blank question", () => {
    useAsk.getState().ask("   ");
    expect(useAsk.getState().pending).toBeNull();
  });
});
