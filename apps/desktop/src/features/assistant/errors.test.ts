import { describe, expect, it } from "vitest";
import { describeError } from "./errors";

describe("describeError", () => {
  it("surfaces a plain string rejection", () => {
    // This is the shape every Tauri command failure arrives in, and the one
    // an `instanceof Error` check silently discards.
    expect(describeError("401 Unauthorized: invalid api key")).toBe(
      "401 Unauthorized: invalid api key",
    );
  });

  it("surfaces an Error's message", () => {
    expect(describeError(new Error("network down"))).toBe("network down");
  });

  it("surfaces a message field on a plain object", () => {
    expect(describeError({ message: "rate limited" })).toBe("rate limited");
  });

  it("serialises an object with no message rather than hiding it", () => {
    expect(describeError({ code: 429 })).toContain("429");
  });

  it("says the backend gave no reason when there genuinely is none", () => {
    // Honest about the absence rather than inventing a cause.
    expect(describeError(undefined)).toMatch(/no reason/i);
    expect(describeError(null)).toMatch(/no reason/i);
    expect(describeError("   ")).toMatch(/no reason/i);
  });

  it("never returns an empty string", () => {
    for (const input of [undefined, null, "", "  ", {}, new Error("")]) {
      expect(describeError(input).length).toBeGreaterThan(0);
    }
  });
});
