import { useEffect, useRef, useState } from "react";
import { getPlatform } from "../platform";
import type { SystemReading } from "../platform/types";

/** How often the machine is asked. */
const EVERY_MS = 2000;

/**
 * How many readings the sparklines remember.
 *
 * Two minutes at the poll rate, which is the span over which "is this thing
 * busy" is a question with an answer. Bounded because this component never
 * unmounts — an unbounded array in the rail is a leak with a two-second
 * clock on it.
 */
const HISTORY = 60;

/** The picture the sparklines are drawn into, in user units. */
const SPARK_W = 100;
const SPARK_H = 16;

/**
 * The quietest network the sparkline will draw at full height.
 *
 * Rates have no ceiling, so the picture must scale to what it has seen — and
 * without a floor a machine doing nothing draws its own noise as a mountain
 * range: 200 bytes a second becomes a full-height spike and the rail reports
 * drama that is not happening.
 */
const NET_FLOOR = 64 * 1024;

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

/**
 * A series as SVG polyline points, oldest on the left.
 *
 * A reading above `scale` is drawn at the top rather than above the box,
 * where it would be clipped or overlap the row above. One reading is a dot on
 * the left rather than a line, and none is nothing at all.
 */
export function sparkPoints(
  values: number[],
  width: number,
  height: number,
  scale: number,
): string {
  if (values.length === 0) return "";
  const top = scale > 0 ? scale : 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  return values
    .map((value, i) => {
      const clamped = Math.min(Math.max(value, 0), top);
      const y = height - (clamped / top) * height;
      return `${Math.round(i * step)},${Math.round(y)}`;
    })
    .join(" ");
}

/** What to scale the network picture against. See `NET_FLOOR`. */
export function netScale(values: number[]): number {
  return Math.max(NET_FLOOR, ...values, 0);
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
  const [history, setHistory] = useState<SystemReading[]>([]);
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
          setHistory((past) => [...past, next].slice(-HISTORY));
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

  const memTotal = reading?.mem_total ?? 0;
  const rx = history.map((h) => h.net_rx_bps);
  const tx = history.map((h) => h.net_tx_bps);
  const netTop = netScale([...rx, ...tx]);

  return (
    <div className="sys" role="group" aria-label="System">
      <Metric
        label="CPU"
        value={reading ? `${Math.round(reading.cpu_pct)}%` : "—"}
        hot={cpu >= 85}
        // A fixed 0–100 scale. Auto-scaling this would make an idle machine's
        // 2% jitter look identical to a pegged core, which is the one
        // distinction the row exists to make.
        points={sparkPoints(history.map((h) => h.cpu_pct), SPARK_W, SPARK_H, 100)}
      />

      <Metric
        label="RAM"
        value={reading ? `${size(reading.mem_used)} / ${size(reading.mem_total)}` : "—"}
        hot={ram >= 85}
        points={sparkPoints(history.map((h) => h.mem_used), SPARK_W, SPARK_H, memTotal)}
      />

      {/* Disk gets a bar, not a sparkline. It does not move on this
          timescale, and a flat line for ever would be a picture of nothing
          pretending to be a reading. */}
      <div className="sys__row">
        <span className="sys__label">Disk</span>
        <span className="sys__value">
          {reading ? `${size(reading.disk_used)} / ${size(reading.disk_total)}` : "—"}
        </span>
        <span className="sys__bar" aria-hidden="true">
          <span className="sys__fill" style={{ width: `${disk}%` }} data-hot={disk >= 85 || undefined} />
        </span>
      </div>

      {/* Two lines on one scale, so down and up are comparable to each other
          rather than each filling its own box. */}
      <div className="sys__row sys__row--net" aria-label="Network">
        <span className="sys__label">Net</span>
        <span className="sys__net">
          <span className="sys__dir">
            <span className="sys__arrow" aria-hidden="true">
              ↓
            </span>
            <span className="sys__value">{reading ? rateText(reading.net_rx_bps) : "—"}</span>
          </span>
          <span className="sys__dir">
            <span className="sys__arrow" aria-hidden="true">
              ↑
            </span>
            <span className="sys__value">{reading ? rateText(reading.net_tx_bps) : "—"}</span>
          </span>
        </span>
        <Spark points={sparkPoints(rx, SPARK_W, SPARK_H, netTop)} className="sys__spark--rx" />
        <Spark points={sparkPoints(tx, SPARK_W, SPARK_H, netTop)} className="sys__spark--tx" />
      </div>
    </div>
  );
}

/** One reading, its number, and the shape of the last two minutes. */
function Metric({
  label,
  value,
  points,
  hot,
}: {
  label: string;
  value: string;
  points: string;
  hot: boolean;
}) {
  return (
    <div className="sys__row" data-hot={hot || undefined}>
      <span className="sys__label">{label}</span>
      <span className="sys__value">{value}</span>
      <Spark points={points} />
    </div>
  );
}

/**
 * The picture.
 *
 * `aria-hidden`, because the number beside it already says what it says — a
 * screen reader reading out a shape it cannot convey would be noise. The
 * polyline is not scaled by CSS: `vectorEffect` keeps the stroke one pixel
 * wide however wide the rail gets.
 */
function Spark({ points, className }: { points: string; className?: string }) {
  return (
    <svg
      className={className ? `sys__spark ${className}` : "sys__spark"}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {points !== "" && (
        <polyline points={points} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
