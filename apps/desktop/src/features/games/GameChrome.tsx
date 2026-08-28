import type { ReactNode } from "react";

/**
 * The window each game sits in.
 *
 * Traffic lights, a title, a hint about how to play, and a slot on the right
 * for whatever the game wants to show — the arcade-cabinet framing that makes
 * four different games read as one suite rather than four experiments.
 */
export function GameWindow({
  title,
  glyph,
  hint,
  right,
  children,
}: {
  title: string;
  glyph: string;
  hint: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gw" aria-label={title}>
      <header className="gw__bar">
        <span className="gw__lights" aria-hidden="true">
          <i className="gw__light gw__light--red" />
          <i className="gw__light gw__light--amber" />
          <i className="gw__light gw__light--green" />
        </span>
        <span className="gw__glyph" aria-hidden="true">
          {glyph}
        </span>
        <h2 className="gw__title">{title}</h2>
        <span className="gw__hint">{hint}</span>
        {right && <span className="gw__right">{right}</span>}
      </header>
      <div className="gw__body">{children}</div>
    </section>
  );
}

/** A labelled readout, the way an arcade cabinet shows a score. */
export function Readout({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "accent" | "mint" | "warn" | "violet";
}) {
  return (
    <span className="readout" data-tone={tone}>
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
    </span>
  );
}

/** A bordered side panel, for controls, stats and scoreboards. */
export function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "accent" | "mint" | "warn" | "violet" | "magenta";
  children: ReactNode;
}) {
  return (
    <section className="gpanel" data-tone={tone} aria-label={title}>
      <h3 className="gpanel__title">{title}</h3>
      <div className="gpanel__body">{children}</div>
    </section>
  );
}

/**
 * A bar chart of eight cells, for "how fast is this going".
 *
 * Eight rather than a percentage because a number that ticks over constantly
 * is noise, and a bar you can read at a glance without looking directly at it
 * is exactly what a speed indicator should be.
 */
export function Meter({ fraction, tone = "mint" }: { fraction: number; tone?: string }) {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * 8);
  return (
    <span className="meter" data-tone={tone} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className="meter__cell" data-on={i < filled || undefined} />
      ))}
    </span>
  );
}
