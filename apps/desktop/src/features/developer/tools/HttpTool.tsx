import { useState, type FormEvent } from "react";
import { getPlatform } from "../../../platform";
import type { HttpResponse } from "../../../platform/types";
import { CopyButton, ToolFrame, ToolInput } from "./Shared";
import { Examples, WhatFor } from "./Examples";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Header {
  name: string;
  value: string;
}

/**
 * The HTTP client.
 *
 * The request goes out from Rust, not from this window — the window cannot
 * reach any host at all, which is what `connect-src 'self'` means, and that
 * is the reason this tool can exist without being a hole through it. Every
 * rule about what may be sent lives in `jky_apps::http`, in front of the
 * sending.
 *
 * The response is shown whole: status, headers, timing, size. A client that
 * showed only the body would be useless for the half of the problems that
 * are a header or a redirect.
 */
export function HttpTool() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<Header[]>([{ name: "", value: "" }]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState<"body" | "headers">("body");

  /** A body means nothing on these, and offering one invites confusion. */
  const takesBody = !["GET", "HEAD", "OPTIONS"].includes(method);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pairs = headers
        .filter((h) => h.name.trim() !== "")
        .map((h) => [h.name.trim(), h.value] as [string, string]);
      setResponse(
        await getPlatform().tools.request(
          method,
          url.trim(),
          pairs,
          takesBody && body !== "" ? body : null,
        ),
      );
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const setHeader = (i: number, patch: Partial<Header>) =>
    setHeaders((rows) => rows.map((row, at) => (at === i ? { ...row, ...patch } : row)));

  return (
    <ToolFrame hint="Requests are sent by the backend — this window cannot reach any host itself.">
      <WhatFor>
        <p>Send a request and read the whole reply: status, headers, body, size and how long it took.</p>
        <p>
          Reach for it when an endpoint is not doing what you expect and you
          want to see what it actually returns, without writing a script or
          remembering curl's flags.
        </p>
      </WhatFor>

      <Examples
        examples={[
          {
            label: "A JSON API",
            shows: "a real reply, its headers, and the time it took",
            load: () => {
              setMethod("GET");
              setUrl("https://api.github.com/repos/rust-lang/rust");
              setHeaders([{ name: "Accept", value: "application/vnd.github+json" }]);
              setBody("");
            },
          },
          {
            label: "A POST with a body",
            shows: "how a request body and Content-Type are sent",
            load: () => {
              setMethod("POST");
              setUrl("https://httpbin.org/post");
              setHeaders([{ name: "Content-Type", value: "application/json" }]);
              setBody('{\n  "hello": "world"\n}');
            },
          },
          {
            label: "Something local",
            shows: "the error when nothing is listening — a connection, not a 404",
            load: () => {
              setMethod("GET");
              setUrl("http://localhost:3000/health");
              setHeaders([{ name: "", value: "" }]);
              setBody("");
            },
          },
        ]}
      />

      <form className="tl__row" onSubmit={(e) => void send(e)}>
        <label className="tl__sr" htmlFor="http-method">
          Method
        </label>
        <select
          id="http-method"
          className="tl__input tl__input--method"
          aria-label="Method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="tl__sr" htmlFor="http-url">
          URL
        </label>
        <input
          id="http-url"
          className="tl__input tl__input--url"
          aria-label="URL"
          value={url}
          spellCheck={false}
          placeholder="https://api.example.com/things"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="tool" disabled={busy || url.trim() === ""}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      <div className="tl__field">
        <span className="tl__label">Headers</span>
        {headers.map((header, i) => (
          <div className="http__header" key={i}>
            <input
              className="tl__input"
              aria-label={`Header ${i + 1} name`}
              value={header.name}
              spellCheck={false}
              placeholder="Authorization"
              onChange={(e) => setHeader(i, { name: e.target.value })}
            />
            <input
              className="tl__input"
              aria-label={`Header ${i + 1} value`}
              value={header.value}
              spellCheck={false}
              placeholder="Bearer …"
              onChange={(e) => setHeader(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="pill"
              aria-label={`Remove header ${i + 1}`}
              onClick={() => setHeaders((rows) => rows.filter((_, at) => at !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="tool tool--small"
          onClick={() => setHeaders((rows) => [...rows, { name: "", value: "" }])}
        >
          Add header
        </button>
      </div>

      {takesBody && (
        <ToolInput label="Request body" value={body} onChange={setBody} rows={6} />
      )}

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {response && (
        <div className="tl__field">
          <div className="http__status">
            <span className="http__code" data-family={Math.floor(response.status / 100)}>
              {response.status}
            </span>
            <span className="http__reason">{response.status_text}</span>
            <span className="tl__note">
              {response.took_ms} ms · {formatSize(response.size)}
              {response.truncated && " · body truncated"}
            </span>
            <CopyButton text={response.body} label="Copy body" />
          </div>

          <div className="tl__row">
            {(["body", "headers"] as const).map((which) => (
              <button
                key={which}
                type="button"
                className="tool tool--small"
                aria-pressed={showing === which}
                onClick={() => setShowing(which)}
              >
                {which === "body"
                  ? "Body"
                  : `Headers (${Object.keys(response.headers).length})`}
              </button>
            ))}
          </div>

          {showing === "body" ? (
            <pre className="tl__out">{prettyIfJson(response.body)}</pre>
          ) : (
            <dl className="http__headers">
              {Object.entries(response.headers).map(([name, value]) => (
                <div className="http__header-row" key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </ToolFrame>
  );
}

/**
 * A JSON body, laid out.
 *
 * Most APIs answer with JSON on one line, and reading one long line is the
 * thing the JSON tool exists for — so it is done here rather than making
 * someone copy the body into another tool to see it.
 */
function prettyIfJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
