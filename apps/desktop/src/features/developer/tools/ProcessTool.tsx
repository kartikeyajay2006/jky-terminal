import { useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { Proc, ProcSort } from "../../../platform/types";
import { size } from "../../../app/SystemStatus";
import { ToolFrame } from "./Shared";
import { WhatFor } from "./Examples";

const EVERY_MS = 2000;

const ORDERS: { id: ProcSort; label: string }[] = [
  { id: "cpu", label: "Processor" },
  { id: "memory", label: "Memory" },
  { id: "name", label: "Name" },
];

/**
 * The process list.
 *
 * Sorted and cut in Rust — see `tools_processes` — because a busy machine has
 * thousands and cutting before sorting would hand back whatever booted
 * earliest.
 *
 * Ending one is the only thing anywhere in the developer tools that changes
 * the machine, so it asks first. Not a toast that can be missed and not an
 * undo that cannot exist: a second click, on a button that names the process
 * it is about to end.
 */
export function ProcessTool() {
  const [procs, setProcs] = useState<Proc[]>([]);
  const [sort, setSort] = useState<ProcSort>("cpu");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Proc | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const poll = () => {
      void getPlatform()
        .tools.processes(sort, search)
        .then((next) => {
          if (!live) return;
          setProcs(next);
          setError(null);
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e));
        });
    };

    poll();
    const timer = setInterval(poll, EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sort, search]);

  async function end(proc: Proc) {
    setConfirming(null);
    try {
      const signalled = await getPlatform().tools.endProcess(proc.pid);
      // "Signalled" is not "gone": a process may ignore the signal, and
      // claiming otherwise would be a lie the panel repeats.
      setNote(
        signalled
          ? `Asked ${proc.name} (${proc.pid}) to stop. If it ignores that, it will still be here.`
          : `${proc.name} (${proc.pid}) was not there any more.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ToolFrame hint="Refreshed twice a second while this is open. Percentages are across all cores.">
      <WhatFor>
        <p>What is running on this machine, what it is costing, and what it was started with.</p>
        <p>
          Reach for it when the fans come on and you want to know why, or when
          something is holding a file or a port and you need to know what it
          is before you decide what to do about it.
        </p>
      </WhatFor>

      <div className="tl__row">
        <label className="tl__sr" htmlFor="proc-search">
          Search
        </label>
        <input
          id="proc-search"
          className="tl__input"
          type="search"
          aria-label="Search processes"
          placeholder="Name, command, or process id…"
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
        <div className="proc__confirm" role="alertdialog" aria-label="End this process?">
          <p className="proc__confirm-text">
            End <strong>{confirming.name}</strong> ({confirming.pid})? Anything it has not
            saved is lost, and it may be something the system needs.
          </p>
          <div className="tl__row">
            <button type="button" className="tool" onClick={() => void end(confirming)}>
              End {confirming.name}
            </button>
            <button type="button" className="tool tool--quiet" onClick={() => setConfirming(null)}>
              Leave it running
            </button>
          </div>
        </div>
      )}

      <table className="proc__table" aria-label="Processes">
        <thead>
          <tr>
            <th scope="col">Process</th>
            <th scope="col">Id</th>
            <th scope="col">Processor</th>
            <th scope="col">Memory</th>
            <th scope="col">
              <span className="tl__sr">End</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {procs.map((proc) => (
            <tr key={proc.pid}>
              <td className="proc__name">
                <span className="proc__name-text">{proc.name}</span>
                {/* The command, because four processes called `node` are told
                    apart by this and by nothing else. */}
                {proc.command && <span className="proc__cmd">{proc.command}</span>}
              </td>
              <td className="proc__num">{proc.pid}</td>
              <td className="proc__num" data-hot={proc.cpu_pct >= 50 || undefined}>
                {proc.cpu_pct.toFixed(1)}%
              </td>
              <td className="proc__num">{size(proc.mem)}</td>
              <td>
                <button
                  type="button"
                  className="pill pill--danger"
                  aria-label={`End ${proc.name}`}
                  onClick={() => setConfirming(proc)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {procs.length === 0 && !error && (
        <p className="tl__note">
          {search ? "Nothing matches that." : "Reading the process list…"}
        </p>
      )}
    </ToolFrame>
  );
}
