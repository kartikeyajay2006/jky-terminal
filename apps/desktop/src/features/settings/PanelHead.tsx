import type { ReactNode } from "react";

/**
 * The masthead every settings panel wears.
 *
 * Providers grew one of these first and the other panels were left with a
 * plain heading, so moving between them changed both the alignment and the
 * weight of the title. One component means they cannot drift again.
 */
export function PanelHead({
  where,
  headingId,
  status,
}: {
  /** The section's name — this is the heading, and the accessible name. */
  where: string;
  headingId: string;
  /** Optional right-hand count. Pass the whole node so a live one can be. */
  status?: ReactNode;
}) {
  return (
    <header className="mast">
      {/* Decorative, and hidden from the accessible name: a heading that
          reads "JKY·TERMINAL" on all four panels says nothing about which
          one you are looking at. */}
      <span className="mast__brand" aria-hidden="true">
        JKY<i>·</i>TERMINAL
      </span>
      <span className="mast__sep" aria-hidden="true">
        /
      </span>

      <h2 className="mast__where" id={headingId}>
        {where}
      </h2>

      {status !== undefined && <span className="mast__status">{status}</span>}
    </header>
  );
}
