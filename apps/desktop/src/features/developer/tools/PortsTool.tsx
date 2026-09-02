import { useState, type FormEvent } from "react";
import { getPlatform } from "../../../platform";
import type { OpenPort } from "../../../platform/types";
import { ToolFrame } from "./Shared";
import { Examples, WhatFor } from "./Examples";

/**
 * The port scanner.
 *
 * **Loopback only**, and that is a decision rather than a shortcut: scanning
 * a host you do not own is a legal question in several countries and a terms
 * question on every cloud, and this app ships under a real person's name. The
 * panel takes no host for that reason — there is nothing to type, so there is
 * nothing to get wrong.
 *
 * What is left is the question people actually have while developing: what is
 * already on this machine, and what has taken the port I wanted.
 */
export function PortsTool() {
  const [from, setFrom] = useState(3000);
  const [to, setTo] = useState(9100);
  const [open, setOpen] = useState<OpenPort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan(a: number, b: number) {
    setBusy(true);
    setError(null);
    try {
      setOpen(await getPlatform().tools.scanPorts(a, b));
    } catch (e) {
      setOpen(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void scan(from, to);
  }

  return (
    <ToolFrame hint="This machine only. There is no host to type, which is the point.">
      <WhatFor>
        <p>Find which ports on this computer have something listening on them.</p>
        <p>
          Reach for it when a server will not start because the port is taken,
          or when you have forgotten which of four terminals is running the
          thing on 5432.
        </p>
      </WhatFor>

      <Examples
        examples={[
          {
            label: "Development ports",
            shows: "the 3000–9100 range, where most dev servers live",
            load: () => {
              setFrom(3000);
              setTo(9100);
              void scan(3000, 9100);
            },
          },
          {
            label: "Databases",
            shows: "Postgres, MySQL, Redis and Mongo, if any are running",
            load: () => {
              setFrom(3306);
              setTo(6379);
              void scan(3306, 6379);
            },
          },
          {
            label: "The well-known ports",
            shows: "everything under 1024 — ssh, http, and whatever else",
            load: () => {
              setFrom(1);
              setTo(1023);
              void scan(1, 1023);
            },
          },
        ]}
      />

      <form className="tl__row" onSubmit={submit}>
        <label className="tl__sr" htmlFor="port-from">
          First port
        </label>
        <input
          id="port-from"
          className="tl__input tl__input--number"
          type="number"
          aria-label="First port"
          min={1}
          max={65535}
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
        />
        <span className="tl__note">to</span>
        <label className="tl__sr" htmlFor="port-to">
          Last port
        </label>
        <input
          id="port-to"
          className="tl__input tl__input--number"
          type="number"
          aria-label="Last port"
          min={1}
          max={65535}
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
        />
        <button type="submit" className="tool" disabled={busy}>
          {busy ? "Scanning…" : "Scan"}
        </button>
      </form>

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {open && open.length === 0 && (
        <p className="tl__note">Nothing is listening in that range.</p>
      )}

      {open && open.length > 0 && (
        <div className="tl__field">
          <span className="tl__label">
            {open.length} listening between {from} and {to}
          </span>
          <ul className="ports__list" aria-label="Open ports">
            {open.map((port) => (
              <li key={port.port} className="ports__row">
                <code className="ports__num">{port.port}</code>
                {/* A guess from the number, and said as one — nothing here
                    asked the port what it actually is. */}
                <span className="ports__guess">
                  {port.likely ? `probably ${port.likely}` : "unknown"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolFrame>
  );
}
