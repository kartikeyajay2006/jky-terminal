import { useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { Listener, PortSort } from "../../../platform/types";
import { ToolFrame } from "./Shared";
import { WhatFor } from "./Examples";

const EVERY_MS = 2000;

const ORDERS: { id: PortSort; label: string }[] = [
  { id: "port", label: "Port" },
  { id: "process", label: "Process" },
  { id: "reach", label: "Reachable first" },
];

/**
 * Ports that mean something, so a row can say so.
 *
 * Not a lookup table of every registered port — that is a thousand entries
 * nobody reads, and IANA's list says `http` for 80 on a machine where the
 * thing on 80 is a reverse proxy you set up. These are the handful where
 * knowing the convention changes what you do next.
 */
const WELL_KNOWN: Record<number, string> = {
  22: "ssh",
  53: "dns",
  80: "http",
  443: "https",
  3000: "dev server",
  3306: "mysql",
  5173: "vite",
  5432: "postgres",
  6379: "redis",
  8080: "http alt",
  27017: "mongodb",
};

/**
 * What is listening on this machine.
 *
 * The question this answers — "what is on port 3000, and how do I stop it" —
 * is the one a terminal gets asked most and answers worst. The incantation
 * people keep in a note is `lsof -i -P -n | grep LISTEN`, or `ss -tulpn`, or
 * `netstat -ano` depending on the machine; none of them exists everywhere and
 * all of them print a wall of columns to answer a question about one number.
 *
 * Two things here that the raw socket table does not give you:
 *
 * A row is a port, not a socket. A server bound to both IP stacks appears
 * twice in the kernel's table, which is true and is not what anyone asked.
 *
 * And whether the thing is reachable from outside this machine. A dev server
 * on `127.0.0.1` is yours; the same server on `0.0.0.0` is offered to every
 * device on the network, which on a café's wifi is a different situation. No
 * tool that prints a bind address and moves on ever says this out loud.
 *
 * Stopping one goes through the same command the process list uses, which is
 * audited. One way to end a process, one record of it having happened.
 */
export function PortsTool() {
  const [rows, setRows] = useState<Listener[]>([]);
  const [sort, setSort] = useState<PortSort>("port");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Listener | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    let live = true;

    const poll = () => {
      void getPlatform()
        .tools.ports(sort, search)
        .then((next) => {
          if (!live) return;
          setRows(next);
          setError(null);
          setRead(true);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : String(e));
          setRead(true);
        });
    };

    poll();
    const timer = setInterval(poll, EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sort, search]);

  async function end(row: Listener) {
    setConfirming(null);
    if (row.pid === null) return;
    try {
      const signalled = await getPlatform().tools.endProcess(row.pid);
      // "Signalled" is not "gone". A process that ignores the signal is still
      // holding the port, and saying otherwise is a lie the panel repeats.
      setNote(
        signalled
          ? `Asked ${row.process || `process ${row.pid}`} to release port ${row.port}. If it ignores that, it will still be here.`
          : `Nothing was listening on ${row.port} by the time that ran.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  const exposed = rows.filter((r) => r.reach === "network").length;

  return (
    <ToolFrame hint="Refreshed twice a second while this is open. Listening sockets only — an established connection is a different question.">
      <WhatFor>
        <p>What is listening on this machine, what is holding it, and who can reach it.</p>
        <p>
          Reach for it when something says the address is already in use and
          you want to know what has it, or before you hand someone a link to
          your dev server and need to know whether they can actually open it.
        </p>
      </WhatFor>

      <div className="tl__row">
        <label className="tl__sr" htmlFor="ports-search">
          Search
        </label>
        <input
          id="ports-search"
          className="tl__input"
          type="search"
          aria-label="Search ports"
          placeholder="Port, process, command, or pid…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="tl__note">Sort by</span>
        {ORDERS.map((order) => (
          <button
            key={order.id}
            type="button"
            className="tool tool--small"
            aria-pressed={sort === order.id}
            onClick={() => setSort(order.id)}
          >
            {order.label}
          </button>
        ))}
      </div>

      {/* Said once, above the table, because it is the fact that changes what
          you do — and counting the rows yourself is not reading. */}
      {exposed > 0 && !search && (
        <p className="tl__warn" role="status">
          {exposed === 1 ? "One of these is" : `${exposed} of these are`} reachable from the
          network, not just from this machine.
        </p>
      )}

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {note && (
        <p className="tl__warn" role="status">
          {note}
        </p>
      )}

      {confirming && (
        <div className="proc__confirm" role="alertdialog" aria-label="Stop what is on this port?">
          <p className="proc__confirm-text">
            End <strong>{confirming.process || `process ${confirming.pid}`}</strong> to free
            port {confirming.port}? Anything it has not saved is lost, and it may be something
            the system needs.
          </p>
          <div className="tl__row">
            <button type="button" className="tool" onClick={() => void end(confirming)}>
              Free port {confirming.port}
            </button>
            <button type="button" className="tool tool--quiet" onClick={() => setConfirming(null)}>
              Leave it running
            </button>
          </div>
        </div>
      )}

      <table className="proc__table" aria-label="Listening ports">
        <thead>
          <tr>
            <th scope="col">Port</th>
            <th scope="col">Process</th>
            <th scope="col">Reach</th>
            <th scope="col">Id</th>
            <th scope="col">
              <span className="tl__sr">Free the port</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.protocol}-${row.port}-${row.pid ?? "unknown"}`}>
              <td className="proc__name">
                <span className="proc__name-text">
                  {row.port}
                  <span className="ports__proto"> {row.protocol}</span>
                </span>
                <span className="proc__cmd">
                  {WELL_KNOWN[row.port] ? `${WELL_KNOWN[row.port]} · ` : ""}
                  {row.addresses.join(", ")}
                </span>
              </td>
              <td className="proc__name">
                {/* A port this user is not allowed to see the owner of is
                    still worth a row: that the port is taken is the answer
                    to the question, even when what has it is not sayable. */}
                <span className="proc__name-text">
                  {row.process || <span className="ports__unknown">another user</span>}
                </span>
                {row.command && <span className="proc__cmd">{row.command}</span>}
              </td>
              <td>
                <span className="ports__reach" data-reach={row.reach}>
                  {row.reach === "network" ? "network" : "this machine"}
                </span>
              </td>
              <td className="proc__num">{row.pid ?? "—"}</td>
              <td>
                {row.pid !== null && (
                  <button
                    type="button"
                    className="pill pill--danger"
                    aria-label={`Free port ${row.port}`}
                    onClick={() => setConfirming(row)}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && !error && (
        <p className="tl__note">
          {!read
            ? "Reading the socket table…"
            : search
              ? "Nothing matches that."
              : "Nothing is listening."}
        </p>
      )}
    </ToolFrame>
  );
}
