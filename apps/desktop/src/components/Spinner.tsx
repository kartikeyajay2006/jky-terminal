/**
 * Something is happening.
 *
 * A spinner rather than a word, because "Loading…" that never changes looks
 * the same as an app that has stopped. This turns, so it says the app is
 * still working even when nothing else has moved for four seconds.
 *
 * `aria-hidden`, and the label beside it does the announcing: a screen reader
 * reading out a shape it cannot convey is noise. The caller is expected to
 * put the words next to it — see the `label` prop, which does exactly that.
 */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spin" role={label ? "status" : undefined}>
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spin__label">{label}</span>}
    </span>
  );
}
