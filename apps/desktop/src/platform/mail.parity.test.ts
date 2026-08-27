import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIL_PRESETS, looksLikeAnAddress, presetFor, whyNot } from "../features/dashboard/mailPresets";

/**
 * The presets exist in two languages and must not disagree.
 *
 * The frontend picks a host and port; the backend validates and connects with
 * them. A port that drifted on one side would produce a connection that hangs
 * with no explanation.
 */
const RUST = readFileSync(
  join(process.cwd(), "../../crates/jky-mail/src/config.rs"),
  "utf8",
);

describe("mail preset parity", () => {
  it("lists the same providers in both languages", () => {
    const ids = [...RUST.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(MAIL_PRESETS.map((p) => p.id).sort()).toEqual([...ids].sort());
  });

  for (const preset of MAIL_PRESETS) {
    it(`${preset.label} has the same host and port on both sides`, () => {
      const block = RUST.slice(RUST.indexOf(`id: "${preset.id}"`));
      expect(block).toContain(`host: "${preset.host}"`);
      expect(block.slice(0, 400)).toContain(`port: ${preset.port}`);
    });
  }

  it("never uses a plaintext port", () => {
    // 465 is implicit TLS, 587 is STARTTLS. 25 and 2525 have no encryption
    // at all, and a password would go over them in the clear.
    for (const p of MAIL_PRESETS) {
      expect([465, 587], `${p.id} uses ${p.port}`).toContain(p.port);
    }
  });

  it("tells the user what they have to do first", () => {
    // "Authentication failed" with no explanation is the worst outcome here,
    // because the account password looks like the right answer.
    for (const p of MAIL_PRESETS) {
      expect(p.note.length, `${p.id} has no note`).toBeGreaterThan(20);
    }
  });
});

describe("address handling", () => {
  it("finds the provider from the domain", () => {
    expect(presetFor("someone@gmail.com")?.id).toBe("gmail");
    expect(presetFor("SOMEONE@GMAIL.COM")?.id).toBe("gmail");
    expect(presetFor("someone@icloud.com")?.id).toBe("icloud");
  });

  it("finds nothing rather than guessing at an unknown domain", () => {
    expect(presetFor("someone@example.org")).toBeUndefined();
  });

  it("refuses obvious non-addresses", () => {
    for (const bad of ["", "someone", "@gmail.com", "someone@", "someone@gmail", "a b@c.com"]) {
      expect(looksLikeAnAddress(bad), `accepted '${bad}'`).toBe(false);
    }
  });

  it("accepts real ones", () => {
    for (const good of [
      "someone@gmail.com",
      "first.last+tag@sub.domain.co.uk",
      "kartikeya2006jay@gmail.com",
    ]) {
      expect(looksLikeAnAddress(good), `refused '${good}'`).toBe(true);
    }
  });

  it("agrees with the Rust side about what is incomplete", () => {
    expect(whyNot({ address: "", host: "h", port: 465 })).toMatch(/email address/i);
    expect(whyNot({ address: "a@b.com", host: " ", port: 465 })).toMatch(/provider/i);
    expect(whyNot({ address: "a@b.com", host: "h", port: 0 })).toMatch(/465/);
    expect(whyNot({ address: "a@b.com", host: "h", port: 465 })).toBeNull();
  });
});
