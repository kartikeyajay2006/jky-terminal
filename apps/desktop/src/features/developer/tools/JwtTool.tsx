import { useMemo, useState } from "react";
import { ToolFrame, ToolInput } from "./Shared";
import { claimNote, decodeJwt } from "./jwt";
import { Examples, WhatFor } from "./Examples";

/*
 * The examples.
 *
 * Real tokens in shape, with signatures that are nonsense on purpose — this
 * tool never checks one, so a valid signature here would suggest it did.
 */
const SAMPLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwicm9sZXMiOlsiYWRtaW4iXX0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/** Expired at the start of 2025, so the expiry claim is called out. */
const EXPIRED = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiJHcmFjZSBIb3BwZXIiLCJpYXQiOjE3MzU2ODk2MDAsImV4cCI6MTczODM2ODAwMH0.vJvVmXQ2Zk1nL8pQ7rT3sW9xY0aB4cD5eF6gH7iJ8kL";

/*
 * `alg: none`, claiming admin.
 *
 * A real attack, and the reason this tool never says a token is valid: the
 * payload below is perfectly readable and means nothing at all.
 */
const UNSIGNED = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwiYWRtaW4iOnRydWV9.";

/**
 * The JWT decoder.
 *
 * It decodes and it never verifies, and the panel says so where the payload
 * is rather than in small print. Someone reading a decoded payload as a
 * checked one is the single mistake this tool could cause.
 */
export function JwtTool() {
  const [token, setToken] = useState("");
  const decoded = useMemo(() => decodeJwt(token), [token]);
  const now = Date.now() / 1000;

  return (
    <ToolFrame hint="Decodes a token. It has no key, so it never checks the signature.">
      <WhatFor>
        <p>
          Paste a JSON Web Token to read what is inside it — who it says you
          are, what it says you may do, and when it stops being valid.
        </p>
        <p>
          Reach for it when a request comes back 401 and you want to know
          whether the token expired, or whether it is even the account you
          think it is.
        </p>
      </WhatFor>

      <Examples
        examples={[
          {
            label: "A signed token",
            shows: "the header, the claims, and when it was issued",
            load: () => setToken(SAMPLE),
          },
          {
            label: "An expired one",
            shows: "the expiry claim called out in red",
            load: () => setToken(EXPIRED),
          },
          {
            label: "alg: none",
            shows: "an unsigned token — and why this tool never says valid",
            load: () => setToken(UNSIGNED),
          },
        ]}
      />

      <ToolInput
        label="Token"
        value={token}
        onChange={setToken}
        rows={4}
        placeholder="eyJhbGciOi…"
      />

      {token.trim() !== "" && !decoded.ok && (
        <p className="tl__error" role="alert">
          {decoded.message}
        </p>
      )}

      {decoded.ok && (
        <>
          <p className="tl__warn">
            Decoded, <strong>not verified</strong>. Without the signing key nothing here can be
            trusted — a token can say anything, including which algorithm signed it.
          </p>

          <Part title="Header" claims={decoded.header} now={now} />
          <Part title="Payload" claims={decoded.payload} now={now} />

          <div className="tl__field">
            <span className="tl__label">Signature</span>
            <pre className="tl__out tl__out--dim">
              {decoded.signature || "(none — this token is unsigned)"}
            </pre>
          </div>
        </>
      )}
    </ToolFrame>
  );
}

/** One half of a token, as a list of claims rather than as raw JSON. */
function Part({
  title,
  claims,
  now,
}: {
  title: string;
  claims: Record<string, unknown>;
  now: number;
}) {
  return (
    <div className="tl__field">
      <span className="tl__label">{title}</span>
      <dl className="tl__claims">
        {Object.entries(claims).map(([name, value]) => {
          const note = claimNote(name, value, now);
          return (
            <div className="tl__claim" key={name} data-expired={note.includes("expired") || undefined}>
              <dt>{name}</dt>
              <dd>
                <span className="tl__claim-value">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </span>
                {note && <span className="tl__claim-note">{note}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
