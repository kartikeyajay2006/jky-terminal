import { useEffect, useRef, useState } from "react";
import { getPlatform } from "../platform";
import type { SystemReading } from "../platform/types";
import {
  ceiling,
  push,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparkArea,
  sparkLine,
  sparkPoints,
} from "./spark";

/** How often the machine is asked. */
const EVERY_MS = 2000;

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * A byte count as a person would say it.
 *
 * One decimal above a kilobyte and none below: "1023 B" is a real answer and
 * "1023.0 B" is a precision nobody asked for. A reading that is not a number
 * gives back an em dash rather than "NaN" — a machine that cannot report its
 * disk is a real machine, and the panel still has to draw something.
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

/**
 * How long the machine has been up, in the units a person would use.
 *
 * Two units at most. "2d 14h" is the answer; "2d 14h 32m 09s" is a stopwatch,
 * and the seconds would redraw the row every two seconds for no information.
 */
export function uptimeText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** `used` of `total` as a percentage, and never a division by zero. */
export function share(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * The quietest network drawn as a full bar.
 *
 * A rate has no ceiling, so the bar needs something to be a fraction of. A
 * floor stops a machine doing nothing from drawing its own noise as a full
 * bar — 200 bytes a second is not "busy", and a bar that says it is would be
 * the readout lying every time the machine is idle.
 */
const NET_FULL = 2 * 1024 * 1024;

/**
 * What the machine is doing, in the rail above Settings.
 *
 * A labelled box of bars: name, how full, and the figure. Bars rather than
 * lines because the question each row answers is "how much of it is left",
 * which is a proportion — and because at 156px of rail a shape is a smudge
 * while a bar is still a bar.
 *
 * A failed reading keeps the last one. The numbers are two seconds old at
 * worst either way, and a row that empties whenever a sample is missed reads
 * as a broken sidebar rather than as a busy machine.
 */
export function SystemStatus() {
  const [reading, setReading] = useState<SystemReading | null>(null);
  /**
   * The readings behind each figure, oldest first.
   *
   * Kept here rather than derived from `reading`, because a level is all a
   * single reading has and the whole point of the lines is the run before it.
   * One state, not four, so a poll draws once.
   */
  const [history, setHistory] = useState({
    cpu: [] as number[],
    ram: [] as number[],
    disk: [] as number[],
    net: [] as number[],
  });
  /** Kept so an unmount between the ask and the answer sets no state. */
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    const poll = () => {
      void getPlatform()
        .system.status()
        .then((next) => {
          if (!live.current) return;
          setReading(next);
          setHistory((was) => ({
            cpu: push(was.cpu, next.cpu_pct),
            ram: push(was.ram, share(next.mem_used, next.mem_total)),
            disk: push(was.disk, share(next.disk_used, next.disk_total)),
            net: push(was.net, next.net_rx_bps + next.net_tx_bps),
          }));
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
  const net = reading ? reading.net_rx_bps + reading.net_tx_bps : 0;

  return (
    <section className="sys" aria-label="System status">
      <p className="sys__title">
        System status
        {/* Says the readings are still arriving. Without it a frozen poll and
            a quiet machine look exactly alike. */}
        <span className="pulse" aria-hidden="true" data-live={reading ? "" : undefined} />
      </p>

      <Row
        label="CPU"
        tone="cpu"
        fill={cpu}
        series={history.cpu}
        max={100}
        value={reading ? `${Math.round(reading.cpu_pct)}%` : "—"}
      />
      <Row
        label="RAM"
        tone="ram"
        fill={ram}
        series={history.ram}
        max={100}
        value={reading ? `${Math.round(ram)}%` : "—"}
        // The percentage is what fits; the figures behind it are one hover
        // away rather than gone.
        detail={reading ? `${size(reading.mem_used)} of ${size(reading.mem_total)}` : undefined}
      />
      <Row
        label="Disk"
        tone="disk"
        fill={disk}
        series={history.disk}
        max={100}
        value={reading ? `${Math.round(disk)}%` : "—"}
        detail={reading ? `${size(reading.disk_used)} of ${size(reading.disk_total)}` : undefined}
      />
      <Row
        label="Net"
        tone="net"
        fill={share(net, NET_FULL)}
        series={history.net}
        // No ceiling: a network has no maximum, so the line is drawn against
        // the busiest moment it has seen rather than against a number this
        // app invented.
        value={reading ? rateText(net) : "—"}
        detail={
          reading
            ? `down ${rateText(reading.net_rx_bps)}, up ${rateText(reading.net_tx_bps)}`
            : undefined
        }
      />

      {/* No bar: uptime is not a proportion of anything, and a bar under it
          would be a picture of a number that has no maximum. */}
      <p className="sys__row sys__row--plain">
        <span className="sys__label">Uptime</span>
        <span className="sys__value">{reading ? uptimeText(reading.uptime_s) : "—"}</span>
      </p>
    </section>
  );
}

/**
 * One reading: name, bar, figure.
 *
 * The bar is `aria-hidden` because the figure beside it says the same thing,
 * and a screen reader announcing both says everything twice.
 */
function Row({
  label,
  tone,
  fill,
  value,
  detail,
  series,
  max,
}: {
  label: string;
  tone: string;
  fill: number;
  value: string;
  /** Shown on hover, for the figures the row has no width for. */
  detail?: string;
  /** The readings behind the figure, oldest first. */
  series: number[];
  /** A fixed ceiling, where the reading has one. Absent scales to the run. */
  max?: number;
}) {
  const points = sparkPoints(series, ceiling(series, max));

  return (
    <p className="sys__row" data-tone={tone} title={detail}>
      <span className="sys__label">{label}</span>

      {/*
       * A shape rather than a level.
       *
       * The bar said what the machine is doing now, which the figure beside
       * it already said. The line says what it has been doing, which is the
       * part you cannot get any other way — a disk at 82% is a number, and a
       * disk that has climbed nine points in a minute is a problem.
       *
       * Hidden from assistive technology: the figure says the reading, and
       * announcing a hundred coordinates says nothing at all.
       */}
      <span className="sys__spark" aria-hidden="true">
        <svg
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          preserveAspectRatio="none"
          focusable="false"
        >
          <path className="sys__area" d={sparkArea(points)} />
          <polyline
            className="sys__line"
            points={sparkLine(points)}
            data-hot={fill >= 85 || undefined}
          />
        </svg>
      </span>

      <span className="sys__value">{value}</span>
    </p>
  );
}
