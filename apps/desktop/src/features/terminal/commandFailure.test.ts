import { describe, expect, it } from "vitest";
import {
  DONE_PREFIX,
  outputOf,
  decodeDone,
  encodeDone,
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

describe("decodeDone", () => {
  it("reads what the shell sent", () => {
    expect(decodeDone(encodeDone(128, "/repo", "git push"))).toEqual({
      code: 128,
      cwd: "/repo",
      command: "git push",
    });
  });

  /*
   * Every command is reported now, including the ones that worked — a
   * finished command is the moment the terminal decides whether its output
   * can be shown as something better than text, and `ls` does not fail.
   */
  it("reads a command that succeeded", () => {
    expect(decodeDone(encodeDone(0, "/home/me", "ls -l"))).toEqual({
      code: 0,
      cwd: "/home/me",
      command: "ls -l",
    });
  });

  // The directory travels with it: `ls` here is a different answer from
  // `ls` there, and several panels need to know which.
  it("carries the directory the command ran in", () => {
    expect(decodeDone(encodeDone(0, "/a/b c/d", "ls"))!.cwd).toBe("/a/b c/d");
  });

  // OSC 1337 is shared, application-defined space. Consuming a payload that
  // is not ours would swallow another program's sequence.
  it("leaves anything that is not ours alone", () => {
    expect(decodeDone("CurrentDir=/home/x")).toBeNull();
    expect(decodeDone("JKYAsk=aGk=")).toBeNull();
    expect(decodeDone(`${DONE_PREFIX}`)).toBeNull();
    expect(decodeDone(`${DONE_PREFIX}not base64!!`)).toBeNull();
  });

  it("refuses a report it cannot read", () => {
    expect(decodeDone(DONE_PREFIX + btoa("git push"))).toBeNull();
    expect(decodeDone(DONE_PREFIX + btoa("nonsense\n/repo\ngit push"))).toBeNull();
    expect(decodeDone(DONE_PREFIX + btoa("0\nonly two lines"))).toBeNull();
  });

  // A command line can be any length. The panel shows it and the model is
  // sent it, and neither wants a megabyte.
  it("bounds a command of unreasonable length", () => {
    const long = decodeDone(encodeDone(1, "/repo", "x".repeat(9000)));
    expect(long!.command.length).toBeLessThanOrEqual(256);
  });

  // The shell reports the prompt it drew before anything was typed.
  it("survives a command that is empty", () => {
    expect(decodeDone(encodeDone(0, "/repo", ""))).toEqual({
      code: 0,
      cwd: "/repo",
      command: "",
    });
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
  const failure = { code: 128, cwd: "/repo", command: "git push" };

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
    const text = helpRequest("fix", { code: 1, cwd: "/repo", command: "" }, "").text;
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

describe("outputOf", () => {
  /*
   * The region between two reports holds the prompt, the command, and then
   * the output. Only the third is what the command printed.
   */
  it("drops the prompt and the command", () => {
    const region = ["me@box:~$ ls -l", "total 8", "drwxr-xr-x  2 me me 4096 src"];
    expect(outputOf(region, "ls -l")).toBe("total 8\ndrwxr-xr-x  2 me me 4096 src");
  });

  // Prompts wrap, and so do long commands, so the command is found rather
  // than assumed to be on the first line.
  it("finds a command that wrapped across two lines", () => {
    const region = ["me@box:~$ docker run --rm -it --name a-very-long", "-container-name alpine sh", "output here"];
    expect(outputOf(region, "docker run --rm -it --name a-very-long-container-name alpine sh")).toBe(
      "output here",
    );
  });

  it("handles a multi-line prompt", () => {
    const region = ["┌──(me㉿box)", "└─$ df -h", "Filesystem Size", "/dev/a 1G"];
    expect(outputOf(region, "df -h")).toBe("Filesystem Size\n/dev/a 1G");
  });

  it("gives nothing back for a command that printed nothing", () => {
    expect(outputOf(["me@box:~$ mkdir thing"], "mkdir thing")).toBe("");
  });

  /*
   * When the command cannot be found, the whole region is returned rather
   * than a guess at how much to drop.
   *
   * A recogniser handed a prompt line usually refuses, because the header is
   * not where it expects — and refusing is the safe direction. Dropping the
   * wrong number of lines is not: it produces a table that looks right.
   */
  it("returns everything rather than guessing when it cannot find the command", () => {
    const region = ["some text", "more text"];
    expect(outputOf(region, "a command that is not in there")).toBe("some text\nmore text");
  });

  it("survives an empty command and an empty region", () => {
    expect(outputOf([], "ls")).toBe("");
    expect(outputOf(["a", "b"], "")).toBe("a\nb");
  });
});
