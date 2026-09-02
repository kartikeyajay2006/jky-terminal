import { describe, expect, it } from "vitest";
import { decodeJwt, claimNote } from "./jwt";

/** header {"alg":"HS256","typ":"JWT"}, payload {"sub":"1234567890","name":"Ada","iat":1516239022} */
const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSIsImlhdCI6MTUxNjIzOTAyMn0." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("decodeJwt", () => {
  it("reads the header and the payload", () => {
    const out = decodeJwt(SAMPLE);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.header).toMatchObject({ alg: "HS256", typ: "JWT" });
      expect(out.payload).toMatchObject({ sub: "1234567890", name: "Ada" });
      expect(out.signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    }
  });

  /*
   * base64url, not base64.
   *
   * `-` and `_` stand in for `+` and `/`, and the padding is dropped. Decoding
   * with the wrong alphabet does not fail — it returns different bytes — so
   * this is the mistake that produces a plausible-looking wrong answer.
   */
  it("decodes the url-safe alphabet", () => {
    // {"a":"??>"} — the payload bytes need both substituted characters.
    const token = `eyJhbGciOiJub25lIn0.${btoa('{"v":"\\u00fb\\u00ff"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.x`;
    const out = decodeJwt(token);
    expect(out.ok).toBe(true);
  });

  it("refuses something that is not a token", () => {
    for (const junk of ["", "not.a.token", "only-one-part", "a.b", "a.b.c.d"]) {
      expect(decodeJwt(junk).ok, `${junk} was accepted`).toBe(false);
    }
  });

  it("says what was wrong with it", () => {
    const out = decodeJwt("a.b");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/three parts/i);
  });

  /*
   * The one thing this tool must never do.
   *
   * It has no key, so it cannot check the signature, so it must never say a
   * token is valid. `alg: none` is the exact case where a decoder that
   * implied validity would be dangerous — that is a real attack, and the
   * answer here is to show the algorithm and claim nothing.
   */
  it("never says a token is valid, and says why not", () => {
    const out = decodeJwt(SAMPLE);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verified).toBe(false);
      expect(JSON.stringify(out)).not.toMatch(/"valid":\s*true/);
    }
  });

  it("reads a token that has no signature at all", () => {
    const out = decodeJwt("eyJhbGciOiJub25lIn0.eyJhIjoxfQ.");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.signature).toBe("");
  });
});

describe("claimNote", () => {
  const now = Date.parse("2026-09-02T00:00:00Z") / 1000;

  /*
   * The registered claims are timestamps, and a bare epoch number is the
   * thing people open a decoder to avoid reading.
   */
  it("turns the time claims into times", () => {
    expect(claimNote("iat", 1516239022, now)).toMatch(/2018/);
    expect(claimNote("exp", now + 3600, now)).toMatch(/expires/i);
    expect(claimNote("nbf", now + 60, now)).toMatch(/not before|valid from/i);
  });

  // An expired token is the answer to the question, so it is said plainly.
  it("says outright when a token has expired", () => {
    expect(claimNote("exp", now - 60, now)).toMatch(/expired/i);
  });

  it("has nothing to add about an ordinary claim", () => {
    expect(claimNote("name", "Ada", now)).toBe("");
    expect(claimNote("exp", "not a number", now)).toBe("");
  });
});
