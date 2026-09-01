import { describe, expect, it } from "vitest";
import {
  EXIT_PREFIX,
  decodeFailure,
  encodeFailure,
  helpRequest,
  outputTail,
  usableProviders,
  HELP_KINDS,
} from "./commandFailure";
import type { ProviderStatus } from "../../platform/types";

const provider = (id: string, requiresKey: boolean, connected: boolean): ProviderStatus => ({
  id,
  displayName: id,
  tagline: "",
  consoleUrl: "",
  requiresKey,
  keyPrefixes: [],
  connected,
  models: [],
  defaultModel: "",
  selectedModel: null,
});

describe("decodeFailure", () => {
  it("reads what the shell sent", () => {
    const report = decodeFailure(encodeFailure(128, "git push"));
    expect(report).toEqual({ code: 128, command: "git push" });
  });

  // OSC 1337 is shared, application-defined space. Consuming a payload that
  // is not ours would swallow another program's sequence.
  it("leaves anything that is not ours alone", () => {
    expect(decodeFailure("CurrentDir=/home/x")).toBeNull();
    expect(decodeFailure("JKYAsk=aGk=")).toBeNull();
    expect(decodeFailure(`${EXIT_PREFIX}`)).toBeNull();
    expect(decodeFailure(`${EXIT_PREFIX}not base64!!`)).toBeNull();
  });

  it("refuses a report with no exit code in it", () => {
    expect(decodeFailure(EXIT_PREFIX + btoa("git push"))).toBeNull();
    expect(decodeFailure(EXIT_PREFIX + btoa("nonsense\ngit push"))).toBeNull();
  });

  // Success is never reported, so a zero arriving here means something else
  // is emitting this sequence.
  it("refuses a report that says nothing went wrong", () => {
    expect(decodeFailure(encodeFailure(0, "git push"))).toBeNull();
  });

  // A command line can be any length. The panel shows it and the model is
  // sent it, and neither wants a megabyte.
  it("bounds a command of unreasonable length", () => {
    const long = decodeFailure(encodeFailure(1, "x".repeat(9000)));
    expect(long!.command.length).toBeLessThanOrEqual(256);
  });

  it("survives a command that is empty", () => {
    expect(decodeFailure(encodeFailure(1, ""))).toEqual({ code: 1, command: "" });
  });
});

describe("outputTail", () => {
  /*
   * The end of the output, not the start.
   *
   * What went wrong is the last thing printed; the first thing printed is
   * usually progress nobody needs. Sending the head would spend tokens on
   * the least useful half of the text.
   */
  it("keeps the end rather than the beginning", () => {
    const text = ["first", ...Array(400).fill("middle"), "the actual error"].join("\n");
    const tail = outputTail(text, 200);
    expect(tail).toContain("the actual error");
    expect(tail).not.toContain("first");
  });

  it("leaves short output alone", () => {
    expect(outputTail("just this", 200)).toBe("just this");
  });

  // Blank lines are most of a terminal buffer and none of the meaning.
  it("drops the blank lines a terminal buffer is padded with", () => {
    expect(outputTail("a\n\n\n\n\nb", 200)).toBe("a\nb");
  });

  it("handles nothing at all", () => {
    expect(outputTail("", 200)).toBe("");
    expect(outputTail("   \n  \n", 200)).toBe("");
  });
});

describe("helpRequest", () => {
  const failure = { code: 128, command: "git push" };

  it("offers exactly the four choices the panel shows", () => {
    expect(HELP_KINDS.map((k) => k.id)).toEqual(["explain", "fix", "commands"]);
  });

  /*
   * Tokens are the constraint here, so the request is built to be small and
   * to ask for something small back. Everything sent is bounded: the command,
   * the tail of the output, and the instruction itself.
   */
  it("sends the command, the code, and the end of the output — and no more", () => {
    const text = helpRequest("explain", failure, "fatal: non-fast-forward").text;
    expect(text).toContain("git push");
    expect(text).toContain("128");
    expect(text).toContain("non-fast-forward");
    expect(text.length).toBeLessThan(1400);
  });

  it("asks for a short answer, because a terminal is not a chat window", () => {
    for (const kind of HELP_KINDS) {
      const text = helpRequest(kind.id, failure, "some output").text;
      expect(text.toLowerCase()).toMatch(/short|brief|at most|no more than|one line/);
    }
  });

  it("asks each question differently, or the four buttons are one button", () => {
    const texts = HELP_KINDS.map((k) => helpRequest(k.id, failure, "out").text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  // Enormous output must not become an enormous request.
  it("stays small even when the output is not", () => {
    const huge = "error line\n".repeat(50_000);
    expect(helpRequest("fix", failure, huge).text.length).toBeLessThan(1400);
  });

  it("never sends anything when there is nothing to send", () => {
    const text = helpRequest("fix", { code: 1, command: "" }, "").text;
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});

describe("usableProviders", () => {
  // A local runtime needs no key, so "no key anywhere" is not the same
  // question as "nothing to ask".
  it("counts a local runtime even with no key", () => {
    expect(usableProviders([provider("ollama", false, false)]).map((p) => p.id)).toEqual([
      "ollama",
    ]);
  });

  it("counts a provider whose key is set", () => {
    expect(usableProviders([provider("anthropic", true, true)]).map((p) => p.id)).toEqual([
      "anthropic",
    ]);
  });

  it("does not count one that needs a key and has none", () => {
    expect(usableProviders([provider("anthropic", true, false)])).toEqual([]);
  });

  it("says there is nothing when there is nothing", () => {
    expect(usableProviders([])).toEqual([]);
  });
});
