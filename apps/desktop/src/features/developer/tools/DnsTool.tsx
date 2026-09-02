import { useState, type FormEvent } from "react";
import { getPlatform } from "../../../platform";
import type { Lookup } from "../../../platform/types";
import { CopyButton, ToolFrame } from "./Shared";
import { Examples, WhatFor } from "./Examples";

/**
 * The DNS tool.
 *
 * Asks the system resolver where a name points — the same question anything
 * else on this machine asks it, which is what makes the answer meaningful:
 * this is where the name goes *from here*, including whatever a VPN or an
 * `/etc/hosts` entry has to say about it.
 *
 * Addresses only, and the panel says so. It is not `dig`.
 */
export function DnsTool() {
  const [host, setHost] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function look(name: string) {
    if (name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      setFound(await getPlatform().tools.resolve(name));
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void look(host);
  }

  return (
    <ToolFrame hint="Uses this machine's own resolver, so the answer includes whatever a VPN or hosts file says.">
      <WhatFor>
        <p>Type a hostname and see the addresses this machine resolves it to.</p>
        <p>
          Reach for it when something connects on one machine and not another.
          The answer here is the one your programs get — a stale hosts entry or
          a VPN's split DNS shows up immediately.
        </p>
      </WhatFor>

      <Examples
        examples={[
          {
            label: "This machine",
            shows: "localhost, and the two addresses it usually has",
            load: () => {
              setHost("localhost");
              void look("localhost");
            },
          },
          {
            label: "A name with several addresses",
            shows: "a CDN, which answers with a different set nearly every time",
            load: () => {
              setHost("github.com");
              void look("github.com");
            },
          },
          {
            label: "A name that does not exist",
            shows: "the resolver's own words when it finds nothing",
            load: () => {
              setHost("this-name-does-not-exist.invalid");
              void look("this-name-does-not-exist.invalid");
            },
          },
        ]}
      />

      <form className="tl__row" onSubmit={submit}>
        <label className="tl__sr" htmlFor="dns-host">
          Hostname
        </label>
        <input
          id="dns-host"
          className="tl__input"
          aria-label="Hostname"
          value={host}
          spellCheck={false}
          placeholder="example.com"
          onChange={(e) => setHost(e.target.value)}
        />
        <button type="submit" className="tool" disabled={busy || host.trim() === ""}>
          {busy ? "Looking…" : "Look up"}
        </button>
      </form>

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {found && (
        <div className="tl__field">
          <div className="tl__label tl__label--row">
            <span>
              {found.addresses.length} address{found.addresses.length === 1 ? "" : "es"} ·{" "}
              {found.took_ms} ms
            </span>
            <CopyButton text={found.addresses.join("\n")} />
          </div>
          <ul className="dns__list" aria-label="Addresses">
            {found.addresses.map((address) => (
              <li key={address} className="dns__row">
                <code>{address}</code>
                {/* Which family, because "it works on IPv4 and not IPv6" is
                    the failure this tool is most often opened for. */}
                <span className="dns__kind">{address.includes(":") ? "IPv6" : "IPv4"}</span>
              </li>
            ))}
          </ul>
          <p className="tl__note">
            Addresses only — this asks the system resolver, not a DNS server, so there are no
            MX or TXT records to show.
          </p>
        </div>
      )}
    </ToolFrame>
  );
}
