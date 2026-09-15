/**
 * The JKY glyph's geometry, on a 64-unit grid.
 *
 * In one place because two things draw it: the mark, wherever React renders
 * it, and the emblem, which is built without React so a terminal can pin it
 * beside its wordmark. Two copies of a logo's coordinates drift, and a logo
 * that is subtly different in two places is worse than one that is wrong in
 * both.
 */
export const JKY_GLYPH = {
  /** The rounded square the mark sits in. */
  frame: { x: 3, y: 3, size: 58, radius: 17 },
  /** A shell prompt's chevron. */
  chevron: "M19 22 L30 32 L19 42",
  /** The J: its stem drops from the prompt's line and hooks left. */
  hook: "M45 20 L45 38 Q45 46 37 46",
  /** The cursor, where one would sit after the prompt. */
  spark: { cx: 45, cy: 14, r: 3 },
  /** One weight for the chevron and the hook, which is what makes them one glyph. */
  stroke: 4.5,
} as const;
