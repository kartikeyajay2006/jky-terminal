import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonTool } from "./JsonTool";
import { JwtTool } from "./JwtTool";
import { RegexTool } from "./RegexTool";
import { HashTool } from "./HashTool";
import { YamlTool } from "./YamlTool";
import { DiffTool } from "./DiffTool";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { Platform } from "../../../platform/types";
import type { RegexResult } from "./regexEngine";

const typist = () => userEvent.setup();

/** A platform whose Rust-backed tools answer. */
function withTools(over: Partial<Platform["tools"]> = {}): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    tools: {
      async hash() {
        return { md5: "m".repeat(32), sha1: "s".repeat(40), sha256: "t".repeat(64), sha512: "u".repeat(128) };
      },
      async diff() {
        return {
          lines: [
            { kind: "same", old: 1, new: 1, text: "keep" },
            { kind: "removed", old: 2, new: null, text: "gone" },
            { kind: "added", old: null, new: 2, text: "new" },
          ],
          added: 1,
          removed: 1,
        };
      },
      async yamlToJson() {
        return '{\n  "a": 1\n}';
      },
      async formatYaml() {
        return "a: 1\n";
      },
      ...over,
    },
  };
}

beforeEach(() => __setPlatformForTests(withTools()));
afterEach(() => __setPlatformForTests(null));

describe("JsonTool", () => {
  it("formats what is typed", async () => {
    const user = typist();
    render(<JsonTool />);
    await user.click(screen.getByRole("textbox", { name: /json/i }));
    await user.paste('{"a":1}');
    expect(await screen.findByText(/"a": 1/)).toBeInTheDocument();
  });

  // The whole reason to build this rather than use JSON.parse in a console.
  it("says which line and column stopped it", async () => {
    const user = typist();
    render(<JsonTool />);
    await user.click(screen.getByRole("textbox", { name: /json/i }));
    await user.paste('{"a":,}');
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/line 1/i);
    expect(alert).toHaveTextContent(/column/i);
  });

  it("minifies as well as formats", async () => {
    const user = typist();
    render(<JsonTool />);
    await user.click(screen.getByRole("textbox", { name: /json/i }));
    await user.paste('{"a": 1}');
    await user.click(screen.getByRole("button", { name: /minify/i }));
    expect(await screen.findByText('{"a":1}')).toBeInTheDocument();
  });

  /*
   * Quietly changing a number is the one way this tool could do real harm,
   * so it says so where the answer is.
   */
  it("warns when reformatting would change a number", async () => {
    const user = typist();
    render(<JsonTool />);
    await user.click(screen.getByRole("textbox", { name: /json/i }));
    await user.paste('{"id":12345678901234567890}');
    expect(await screen.findByText(/precision|too large|rounded/i)).toBeInTheDocument();
  });

  it("says what is in the document", async () => {
    const user = typist();
    render(<JsonTool />);
    await user.click(screen.getByRole("textbox", { name: /json/i }));
    await user.paste('{"a":[1,2]}');
    expect(await screen.findByText(/depth/i)).toBeInTheDocument();
  });
});

describe("JwtTool", () => {
  const SAMPLE =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSIsImlhdCI6MTUxNjIzOTAyMn0." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("shows the header and the payload", async () => {
    const user = typist();
    render(<JwtTool />);
    await user.click(screen.getByRole("textbox", { name: /token/i }));
    await user.paste(SAMPLE);

    expect(await screen.findByText(/HS256/)).toBeInTheDocument();
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
  });

  /*
   * The one thing it must always say. Without it, someone reads a decoded
   * payload as a checked one, which is the mistake this tool could cause.
   */
  it("says it has not checked the signature", async () => {
    const user = typist();
    render(<JwtTool />);
    await user.click(screen.getByRole("textbox", { name: /token/i }));
    await user.paste(SAMPLE);

    expect(await screen.findByText(/not verified|never verif|cannot verify/i)).toBeInTheDocument();
  });

  it("says what is wrong with something that is not a token", async () => {
    const user = typist();
    render(<JwtTool />);
    await user.click(screen.getByRole("textbox", { name: /token/i }));
    await user.paste("nonsense");
    expect(await screen.findByRole("alert")).toHaveTextContent(/three parts/i);
  });

  it("turns the time claims into times", async () => {
    const user = typist();
    render(<JwtTool />);
    await user.click(screen.getByRole("textbox", { name: /token/i }));
    await user.paste(SAMPLE);
    expect(await screen.findByText(/2018/)).toBeInTheDocument();
  });
});

describe("RegexTool", () => {
  /** A worker that answers immediately with a fixed result. */
  function answering(result: RegexResult) {
    return () =>
      ({
        set onmessage(handler: (e: MessageEvent<RegexResult>) => void) {
          queueMicrotask(() => handler({ data: result } as MessageEvent<RegexResult>));
        },
        postMessage() {},
        terminate() {},
      }) as unknown as Worker;
  }

  it("shows the matches it found", async () => {
    const user = typist();
    render(
      <RegexTool
        makeWorker={answering({
          ok: true,
          truncated: false,
          matches: [{ text: "ab", index: 1, groups: ["b"], named: {} }],
        })}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /pattern/i }), "a(b)");
    expect(await screen.findByText("ab")).toBeInTheDocument();
    expect(await screen.findByText(/1 match/i)).toBeInTheDocument();
  });

  it("says when a pattern matched nothing", async () => {
    const user = typist();
    render(<RegexTool makeWorker={answering({ ok: true, truncated: false, matches: [] })} />);
    await user.type(screen.getByRole("textbox", { name: /pattern/i }), "zzz");
    expect(await screen.findByText(/no match/i)).toBeInTheDocument();
  });

  it("says what is wrong with a pattern that is not one", async () => {
    const user = typist();
    render(<RegexTool makeWorker={answering({ ok: false, message: "unterminated group" })} />);
    await user.type(screen.getByRole("textbox", { name: /pattern/i }), "a(");
    expect(await screen.findByRole("alert")).toHaveTextContent(/unterminated group/i);
  });

  it("offers the flags", async () => {
    render(<RegexTool makeWorker={answering({ ok: true, truncated: false, matches: [] })} />);
    expect(screen.getByRole("checkbox", { name: /ignore case/i })).toBeInTheDocument();
  });
});

describe("HashTool", () => {
  it("shows every digest at once", async () => {
    const user = typist();
    render(<HashTool />);
    await user.type(screen.getByRole("textbox", { name: /text/i }), "abc");

    await waitFor(() => expect(screen.getByText("m".repeat(32))).toBeInTheDocument());
    for (const label of ["MD5", "SHA-1", "SHA-256", "SHA-512"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  /*
   * MD5 and SHA-1 are here because files and old systems still use them, not
   * because they are safe. Listing them without saying so would be the tool
   * quietly endorsing them.
   */
  it("says which of these should not be trusted", async () => {
    render(<HashTool />);
    expect(screen.getByText(/not.*secure|broken|do not use/i)).toBeInTheDocument();
  });

  it("says so when the backend refuses", async () => {
    __setPlatformForTests(
      withTools({
        async hash() {
          throw new Error("that is too much text for this tool");
        },
      }),
    );
    const user = typist();
    render(<HashTool />);
    await user.type(screen.getByRole("textbox", { name: /text/i }), "abc");
    expect(await screen.findByRole("alert")).toHaveTextContent(/too much text/i);
  });
});

describe("YamlTool", () => {
  /*
   * Both buttons take either format.
   *
   * "To YAML" used to demand JSON, so with YAML in the box — which is what
   * the tool is for — it answered "that is not valid JSON" every time. YAML
   * is a superset of JSON, so one parser reads both and the question does not
   * arise.
   */
  it("writes YAML back from YAML", async () => {
    const user = typist();
    render(<YamlTool />);
    await user.type(screen.getByRole("textbox", { name: /yaml/i }), "a:  1");
    await user.click(screen.getByRole("button", { name: /to yaml/i }));

    // Scoped to the output: the input box holds text of its own, and an
    // unscoped match would pass whether or not anything came back.
    const { container } = render(<span />);
    void container;
    await waitFor(() =>
      expect(document.querySelector(".tl__out")?.textContent).toMatch(/a: 1/),
    );
  });

  it("writes YAML back from JSON, without being told which it is", async () => {
    const user = typist();
    render(<YamlTool />);
    await user.click(screen.getByRole("textbox", { name: /yaml/i }));
    await user.paste('{"a": 1}');
    await user.click(screen.getByRole("button", { name: /to yaml/i }));
    await waitFor(() => expect(document.querySelector(".tl__out")?.textContent).toMatch(/a: 1/));
  });

  it("converts to JSON", async () => {
    const user = typist();
    render(<YamlTool />);
    await user.type(screen.getByRole("textbox", { name: /yaml/i }), "a: 1");
    await user.click(screen.getByRole("button", { name: /to json/i }));
    expect(await screen.findByText(/"a": 1/)).toBeInTheDocument();
  });

  it("passes a parse error through, position and all", async () => {
    __setPlatformForTests(
      withTools({
        async formatYaml() {
          throw new Error("that is not valid YAML: mapping values at line 2 column 3");
        },
      }),
    );
    const user = typist();
    render(<YamlTool />);
    await user.type(screen.getByRole("textbox", { name: /yaml/i }), "bad");
    await user.click(screen.getByRole("button", { name: /to yaml/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/line 2/i);
  });
});

describe("DiffTool", () => {
  it("shows what changed, with both line numbers", async () => {
    const user = typist();
    render(<DiffTool />);
    await user.type(screen.getByRole("textbox", { name: /before/i }), "keep");
    await user.type(screen.getByRole("textbox", { name: /after/i }), "keep2");
    await user.click(screen.getByRole("button", { name: /compare/i }));

    const table = await screen.findByRole("table", { name: /difference/i });
    expect(within(table).getByText("gone")).toBeInTheDocument();
    expect(within(table).getByText("new")).toBeInTheDocument();
  });

  it("counts the changes", async () => {
    const user = typist();
    render(<DiffTool />);
    await user.type(screen.getByRole("textbox", { name: /before/i }), "a");
    await user.type(screen.getByRole("textbox", { name: /after/i }), "b");
    await user.click(screen.getByRole("button", { name: /compare/i }));
    expect(await screen.findByText(/1 added/i)).toBeInTheDocument();
    expect(screen.getByText(/1 removed/i)).toBeInTheDocument();
  });

  // Colour alone would not carry it for anyone who cannot see the difference.
  it("marks added and removed lines in text, not only in colour", async () => {
    const user = typist();
    render(<DiffTool />);
    await user.type(screen.getByRole("textbox", { name: /before/i }), "a");
    await user.type(screen.getByRole("textbox", { name: /after/i }), "b");
    await user.click(screen.getByRole("button", { name: /compare/i }));

    const table = await screen.findByRole("table", { name: /difference/i });
    expect(within(table).getByText("+")).toBeInTheDocument();
    expect(within(table).getByText("−")).toBeInTheDocument();
  });
});
