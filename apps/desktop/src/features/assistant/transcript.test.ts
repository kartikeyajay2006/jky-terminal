import { describe, expect, it } from "vitest";
import { ranLine, redactedLine } from "./transcript";

describe("transcript lines", () => {
  it("names a tool and what it returned", () => {
    expect(ranLine({ id: "1", name: "read_file", summary: "12 lines", is_error: false, redacted: 0 })).toBe(
      "\n▸ read_file — 12 lines\n",
    );
  });

  it("says when a tool failed", () => {
    expect(ranLine({ id: "1", name: "read_file", summary: "no such file", is_error: true, redacted: 0 })).toBe(
      "\n▸ read_file — no such file (failed)\n",
    );
  });

  it("says how many secrets were removed from a tool's result", () => {
    expect(ranLine({ id: "1", name: "read_file", summary: "3 lines", is_error: false, redacted: 2 })).toBe(
      "\n▸ read_file — 3 lines · 2 secrets redacted before sending\n",
    );
  });

  it("is singular for one secret, and tolerates an older Rust that does not count", () => {
    expect(ranLine({ id: "1", name: "git_status", summary: "clean", is_error: false, redacted: 1 })).toContain(
      "1 secret redacted",
    );
    expect(ranLine({ id: "1", name: "git_status", summary: "clean", is_error: false })).toBe(
      "\n▸ git_status — clean\n",
    );
  });

  it("tells you a secret in your own message never left", () => {
    expect(redactedLine(1)).toBe(
      "▸ 1 secret in your message was replaced with a label before it was sent.\n\n",
    );
    expect(redactedLine(3)).toContain("3 secrets in your message were replaced");
  });
});
