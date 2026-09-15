import { useId } from "react";
import { JKY_GLYPH } from "./jkyGlyph";

interface JkyMarkProps {
  size?: number;
  /** Breathes slowly. For an idle empty state, not for every instance. */
  animated?: boolean;
}

/**
 * The JKY symbol.
 *
 * A shell prompt's chevron and the hook of a J, sharing one stroke weight,
 * with a cursor dot where one would sit after the prompt — the two things
 * this product is, in one glyph. The wordmark works at banner size and turns
 * to mush at 24px; this does not.
 */
export function JkyMark({ size = 48, animated = false }: JkyMarkProps) {
  // Gradient ids must be unique per instance: duplicates make every later
  // instance render the first one's gradient, which then changes when that
  // instance unmounts.
  const gradientId = useId();
  const glowId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="JKY"
      data-animated={animated ? "true" : undefined}
      className="jkymark"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="55%" stopColor="var(--violet)" />
          <stop offset="100%" stopColor="var(--magenta)" />
        </linearGradient>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill={`url(#${glowId})`} />

      <rect
        x={JKY_GLYPH.frame.x}
        y={JKY_GLYPH.frame.y}
        width={JKY_GLYPH.frame.size}
        height={JKY_GLYPH.frame.size}
        rx={JKY_GLYPH.frame.radius}
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        opacity="0.45"
      />

      {/* The chevron: a shell prompt. */}
      <path
        d={JKY_GLYPH.chevron}
        stroke={`url(#${gradientId})`}
        strokeWidth={JKY_GLYPH.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The J: its stem drops from the prompt's line and hooks left. */}
      <path
        d={JKY_GLYPH.hook}
        stroke={`url(#${gradientId})`}
        strokeWidth={JKY_GLYPH.stroke}
        strokeLinecap="round"
        fill="none"
      />

      {/* The cursor, where one would sit after the prompt. */}
      <circle
        cx={JKY_GLYPH.spark.cx}
        cy={JKY_GLYPH.spark.cy}
        r={JKY_GLYPH.spark.r}
        fill="var(--accent)"
        className="jkymark__spark"
      />
    </svg>
  );
}
