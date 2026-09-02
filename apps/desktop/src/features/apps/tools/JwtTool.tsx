import { useMemo, useState } from "react";
import { ToolFrame, ToolInput } from "./Shared";
import { claimNote, decodeJwt } from "./jwt";

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
