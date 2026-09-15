import { useEffect, useRef } from "react";
import { buildEmblem } from "./emblemSvg";

/**
 * The emblem, for the places React draws.
 *
 * A terminal pins the same drawing beside its wordmark without React, so this
 * mounts the one builder rather than keeping a second copy of the drawing in
 * JSX. It is decoration, and always sits beside words that say what it is.
 */
export function Emblem() {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const svg = buildEmblem();
    node.append(svg);
    return () => svg.remove();
  }, []);

  return <span ref={host} className="emblem-host" aria-hidden="true" />;
}
