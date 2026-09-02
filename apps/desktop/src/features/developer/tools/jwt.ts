/**
 * The JWT decoder.
 *
 * **It decodes. It never verifies, and it never says a token is valid.**
 *
 * That is not a limitation waiting to be lifted; it is the whole safety
 * property. Verifying needs the signing key, which this tool does not have
 * and should not ask for — and a decoder that implied validity would be at
 * its most dangerous on exactly the tokens where it matters. `alg: none` is a
 * real attack, and the honest answer to one is to show the algorithm and
 * claim nothing about it.
 */

export type JwtResult =
  | {
      ok: true;
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
      /** Shown, never checked. Empty for an unsigned token. */
      signature: string;
      /** Always false. Present so nothing downstream has to assume. */
      verified: false;
    }
  | { ok: false; message: string };

/**
 * base64url, which is not base64.
 *
 * `-` and `_` stand in for `+` and `/`, and the padding is dropped. Decoding
 * with the wrong alphabet does not throw — it returns different bytes — so
 * this is the mistake that yields a plausible-looking wrong answer rather
 * than an error.
 */
function fromBase64Url(part: string): string {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function asObject(json: string, what: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`the ${what} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * What people actually paste, reduced to the token in it.
 *
 * Three things arrive attached to a real token and none of them is part of
 * it: the word `Bearer` (from a header, a curl command, a network tab), the
 * quotes around it (from a JSON field), and whitespace (from anything that
 * wrapped it). Base64url has no whitespace in its alphabet, so removing it
 * cannot lose anything — and refusing all three with "a JWT has three parts"
 * is technically true and useless.
 */
function justTheToken(raw: string): string {
  return raw
    .replace(/^\s*(?:authorization\s*:)?\s*bearer\s+/i, "")
    .replace(/\s+/g, "")
    .replace(/^["']|["']$/g, "");
}

export function decodeJwt(token: string): JwtResult {
  const parts = justTheToken(token).split(".");
  if (parts.length !== 3) {
    return { ok: false, message: "a JWT has three parts separated by dots" };
  }
  if (parts[0] === "" || parts[1] === "") {
    return { ok: false, message: "the header and payload cannot be empty" };
  }

  try {
    return {
      ok: true,
      header: asObject(fromBase64Url(parts[0]), "header"),
      payload: asObject(fromBase64Url(parts[1]), "payload"),
      signature: parts[2],
      verified: false,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "that could not be decoded",
    };
  }
}

/** The registered claims that are times, and what they mean right now. */
const TIME_CLAIMS: Record<string, string> = {
  exp: "expires",
  iat: "issued",
  nbf: "valid from",
  auth_time: "authenticated",
};

/**
 * What a claim means, where that is not obvious from the value.
 *
 * The registered time claims are seconds since the epoch, which is the exact
 * thing people open a decoder to avoid reading. Whether a token has expired
 * is usually the whole question, so it is said in words.
 */
export function claimNote(name: string, value: unknown, nowSeconds: number): string {
  const label = TIME_CLAIMS[name];
  if (!label || typeof value !== "number" || !Number.isFinite(value)) return "";

  const when = new Date(value * 1000);
  if (Number.isNaN(when.getTime())) return "";

  const written = when.toLocaleString();
  if (name === "exp") {
    return value < nowSeconds ? `expired — ${written}` : `expires ${written}`;
  }
  if (name === "nbf" && value > nowSeconds) return `not before ${written}`;
  return `${label} ${written}`;
}
