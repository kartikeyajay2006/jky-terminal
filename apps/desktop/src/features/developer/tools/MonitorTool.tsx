import { useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { Machine } from "../../../platform/types";
import { size, share, uptimeText } from "../../../app/SystemStatus";
import { ToolFrame } from "./Shared";
import { WhatFor } from "./Examples";

/** How often the machine is asked, while this is on screen. */
const EVERY_MS = 2000;

/**
 * The System Monitor.
 *
 * The rail readout in full: every core rather than an average, both disks and
 * swap, and the load average where the OS has one. No examples — the machine
 * is the example, and it is already in front of you.
 *
 * It polls only while it is open. A monitor left running behind a section
 * nobody is looking at is a reading nobody reads, taken for ever.
 */
export function MonitorTool() {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const poll = () => {
      void getPlatform()
        .tools.machine()
        .then((next) => {
          if (!live) return;
          setMachine(next);
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
  }, []);

  /*
   * What this is for, whatever the reading did.
   *
   * An earlier version returned early on an error or before the first
   * reading, which took the explanation with it — so the one moment someone
   * most needs to know what they are looking at was the one moment the panel
   * said nothing.
   */
  const explain = (
    <WhatFor>
      <p>Everything the rail readout shows, in full: every core, both kinds of memory, every disk.</p>
      <p>
        Reach for it when something is slow and you want to know whether it is
        the machine — one core pinned at 100 while the rest idle is a different
        problem from all of them at 60.
      </p>
    </WhatFor>
  );

  if (error) {
    return (
      <ToolFrame hint="">
        {explain}
        <p className="tl__error" role="alert">
          {error}
        </p>
      </ToolFrame>
    );
  }

  if (!machine) {
    return (
      <ToolFrame hint="">
        {explain}
        <p className="tl__note">Reading the machine…</p>
      </ToolFrame>
    );
  }

  const ram = share(machine.mem_used, machine.mem_total);
  const swap = share(machine.swap_used, machine.swap_total);
  const busiest = Math.max(0, ...machine.per_core);

  return (
    <ToolFrame hint="Read straight from the operating system, twice a second, only while this is open.">
      {explain}

      <dl className="mon__facts">
        <Fact label="Host" value={machine.host ?? "unknown"} />
        <Fact label="System" value={machine.os ?? "unknown"} />
        <Fact label="Kernel" value={machine.kernel ?? "unknown"} />
        <Fact label="Processor" value={machine.cpu_brand} />
        <Fact label="Up" value={uptimeText(machine.uptime_s)} />
        {/* Windows has no load average, and three zeroes would read as an
            idle machine rather than as a number that does not exist there. */}
        {machine.load.some((n) => n > 0) && (
          <Fact label="Load" value={machine.load.map((n) => n.toFixed(2)).join("  ")} />
        )}
      </dl>

      <section className="mon__block" aria-label="Processor">
        <div className="mon__head">
          <h3 className="tl__label">Processor · {machine.cores} cores</h3>
          <span className="mon__figure">{Math.round(busiest)}% busiest</span>
        </div>
        {/* Every core, not an average. An average of eight cores hides the
            one that is pinned, which is the thing worth seeing. */}
        <div className="mon__cores">
          {machine.per_core.map((usage, i) => (
            <div className="mon__core" key={i} title={`Core ${i}: ${Math.round(usage)}%`}>
              <span
                className="mon__core-fill"
                style={{ height: `${Math.max(2, usage)}%` }}
                data-hot={usage >= 85 || undefined}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mon__block" aria-label="Memory">
        <Bar
          label="Memory"
          value={`${size(machine.mem_used)} of ${size(machine.mem_total)}`}
          fill={ram}
        />
        {machine.swap_total > 0 && (
          <Bar
            label="Swap"
            value={`${size(machine.swap_used)} of ${size(machine.swap_total)}`}
            fill={swap}
          />
        )}
      </section>

      <section className="mon__block" aria-label="Disks">
        <h3 className="tl__label">Disks</h3>
        {machine.disks.map((disk) => (
          <Bar
            key={disk.mount}
            label={disk.mount}
            value={`${size(disk.total - disk.available)} of ${size(disk.total)}`}
            fill={share(disk.total - disk.available, disk.total)}
            note={disk.kind}
          />
        ))}
      </section>
    </ToolFrame>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="mon__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Bar({
  label,
  value,
  fill,
  note,
}: {
  label: string;
  value: string;
  fill: number;
  note?: string;
}) {
  return (
    <div className="mon__bar-row">
      <span className="mon__bar-label">
        {label}
        {note && <span className="mon__bar-note">{note}</span>}
      </span>
      <span className="mon__figure">{value}</span>
      <span className="mon__bar" aria-hidden="true">
        <span
          className="mon__bar-fill"
          style={{ width: `${fill}%` }}
          data-hot={fill >= 85 || undefined}
        />
      </span>
    </div>
  );
}
