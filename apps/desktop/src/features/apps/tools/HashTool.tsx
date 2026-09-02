import { useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { Hashes } from "../../../platform/types";
import { CopyButton, ToolFrame, ToolInput } from "./Shared";

/** In the order anyone reads them: oldest and weakest first. */
const ROWS: { key: keyof Hashes; label: string; weak?: boolean }[] = [
  { key: "md5", label: "MD5", weak: true },
  { key: "sha1", label: "SHA-1", weak: true },
  { key: "sha256", label: "SHA-256" },
  { key: "sha512", label: "SHA-512" },
];

/**
 * The hash generator.
 *
 * All four at once, because computing them costs nothing next to the round
 * trip and "which of these is the one I have" is answered by seeing them
 * together.
 *
 * MD5 and SHA-1 are here because files and older systems still use them, and
 * the panel says outright that neither proves anything. Listing them beside
 * SHA-256 without a word would be the tool quietly endorsing them.
 */
export function HashTool() {
  const [text, setText] = useState("");
  const [hashes, setHashes] = useState<Hashes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (text === "") {
      setHashes(null);
      setError(null);
      return;
    }

    let live = true;
    void getPlatform()
      .tools.hash(text)
      .then((next) => {
        if (!live) return;
        setHashes(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setHashes(null);
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      live = false;
    };
  }, [text]);

  return (
    <ToolFrame hint="Hashes the bytes of the text, exactly as any other tool would.">
      <ToolInput label="Text" value={text} onChange={setText} rows={5} placeholder="Anything…" />

      <p className="tl__warn">
        MD5 and SHA-1 are <strong>not secure</strong>. They are here for checking files against
        old systems that still publish them, and prove nothing about who made something.
      </p>

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      <dl className="tl__hashes">
        {ROWS.map(({ key, label, weak }) => (
          <div className="tl__hash" key={key} data-weak={weak || undefined}>
            <dt>{label}</dt>
            <dd>
              <code className="tl__hash-value">{hashes?.[key] ?? "—"}</code>
              <CopyButton text={hashes?.[key] ?? ""} />
            </dd>
          </div>
        ))}
      </dl>
    </ToolFrame>
  );
}
