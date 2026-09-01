import { useEffect, useRef, useState } from "react";
import { getPlatform } from "../platform";
import type { SystemReading } from "../platform/types";

/** How often the machine is asked. */
const EVERY_MS = 2000;

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * A byte count as a person would say it.
 *
 * One decimal above a kilobyte and none below: "1023 B" is a real answer and
 * "1023.0 B" is a precision nobody asked for. A reading that is not a number
 * gives back an em dash rather than "NaN" — a machine that cannot report its
 * disk is a real machine, and the bar still has to draw something.
 */
export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** The same, per second. */
export function rateText(bytesPerSecond: number): string {
  const written = size(bytesPerSecond);
  return written === "—" ? written : `${written}/s`;
}

/** `used` of `total` as a whole percentage, and never a division by zero. */
function share(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * What the machine is doing, in the rail above Settings.
 *
 * It is a readout rather than a destination, which is why it sits at the foot
 * of the rail with Settings rather than among the places you can go.
 *
 * A failed reading keeps the last one rather than blanking. The numbers are
 * two seconds old at worst either way, and a row that empties itself every
 * time a sample is missed reads as a broken sidebar rather than as a busy
 * machine.
 */
export function SystemStatus() {
  const [reading, setReading] = useState<SystemReading | null>(null);
  /** Kept so an unmount between the ask and the answer sets no state. */
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    const poll = () => {
      void getPlatform()
        .system.status()
        .then((next) => {
          if (live.current) setReading(next);
        })
        .catch(() => {
          // Keep what we have. See above.
        });
    };

    poll();
    const timer = setInterval(poll, EVERY_MS);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, []);

  const cpu = reading ? share(reading.cpu_pct, 100) : 0;
  const ram = reading ? share(reading.mem_used, reading.mem_total) : 0;
  const disk = reading ? share(reading.disk_used, reading.disk_total) : 0;

  return (
    <div className="sys" role="group" aria-label="System">
      <Row
        label="CPU"
        value={reading ? `${Math.round(reading.cpu_pct)}%` : "—"}
        fill={cpu}
      />
      <Row
        label="RAM"
        value={reading ? `${size(reading.mem_used)} / ${size(reading.mem_total)}` : "—"}
        fill={ram}
      />
      <Row
        label="Disk"
        value={reading ? `${size(reading.disk_used)} / ${size(reading.disk_total)}` : "—"}
        fill={disk}
      />

      {/* Network has no total to be a fraction of, so it gets arrows rather
          than a bar: a rate is not a proportion of anything. */}
      <div className="sys__row sys__row--net" aria-label="Network">
        <span className="sys__label">Net</span>
        <span className="sys__net">
          <span className="sys__dir">
            <span aria-hidden="true">↓</span>
            <span className="sys__value">
              {reading ? rateText(reading.net_rx_bps) : "—"}
            </span>
          </span>
          <span className="sys__dir">
            <span aria-hidden="true">↑</span>
            <span className="sys__value">
              {reading ? rateText(reading.net_tx_bps) : "—"}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * One reading with a bar behind it.
 *
 * The bar is `aria-hidden`: the number beside it says the same thing, and a
 * screen reader announcing both says everything twice.
 */
function Row({ label, value, fill }: { label: string; value: string; fill: number }) {
  return (
    <div className="sys__row">
      <span className="sys__label">{label}</span>
      <span className="sys__value">{value}</span>
      <span className="sys__bar" aria-hidden="true">
        <span className="sys__fill" style={{ width: `${fill}%` }} data-hot={fill >= 85 || undefined} />
      </span>
    </div>
  );
}
