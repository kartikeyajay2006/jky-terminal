import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./catalogue";

/**
 * The provider catalogue exists twice: once in Rust, which the desktop build
 * actually uses, and once here, which the browser build and every test uses.
 * Two copies of the same list drift, and the drift is invisible — the tests
 * keep passing against the stale copy while the real app behaves differently.
 *
 * This parses the Rust source and compares. It is a blunt instrument, but a
 * blunt instrument that fires beats a convention that does not.
 */
const RUST_SOURCE = join(
  process.cwd(),
  "../../crates/jky-secrets/src/provider.rs",
);

/** Map a Rust `ProviderId` variant to the id used on the wire. */
const VARIANT_TO_ID: Record<string, string> = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  GOOGLE: "google",
  MISTRAL: "mistral",
  GROQ: "groq",
  DEEPSEEK: "deepseek",
  XAI: "xai",
  OPENROUTER: "openrouter",
  OLLAMA: "ollama",
};

function rustCatalogue(): Record<string, string[]> {
  const source = readFileSync(RUST_SOURCE, "utf8");
  const out: Record<string, string[]> = {};

  const blocks = source.matchAll(
    /const (\w+)_MODELS: &\[ModelSpec\] = &\[([\s\S]*?)\n\];/g,
  );
  for (const [, variant, body] of blocks) {
    const id = VARIANT_TO_ID[variant];
    if (!id) continue;
    out[id] = [...body.matchAll(/m\("([^"]+)"/g)].map((m) => m[1]);
  }
  return out;
}

describe("provider catalogue parity", () => {
  const rust = rustCatalogue();

  it("finds a catalogue in the Rust source at all", () => {
    // If this fails the parser has gone stale and every check below is
    // vacuously passing, which is worse than no check.
    expect(Object.keys(rust).length).toBeGreaterThanOrEqual(9);
  });

  it("covers exactly the same providers in both languages", () => {
    expect(Object.keys(rust).sort()).toEqual(PROVIDERS.map((p) => p.id).sort());
  });

  for (const provider of PROVIDERS) {
    it(`lists the same models for ${provider.id} in both languages`, () => {
      expect(rust[provider.id]).toEqual(provider.models.map((m) => m.id));
    });
  }

  it("has no Anthropic model id carrying a date suffix", () => {
    // Date-suffixed ids are rejected with a 400. This shipped once.
    const anthropic = PROVIDERS.find((p) => p.id === "anthropic")!;
    for (const model of anthropic.models) {
      expect(model.id).not.toMatch(/-\d{8}$/);
    }
  });
});
