/**
 * What a panel shows before it has anything in it.
 *
 * An empty dashboard is the first thing a new user sees, so each of these
 * says what to do rather than that there is nothing.
 */
export function Empty({
  glyph,
  title,
  hint,
}: {
  glyph: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="empty">
      <span className="empty__glyph" aria-hidden="true">
        {glyph}
      </span>
      <p className="empty__title">{title}</p>
      <p className="empty__hint">{hint}</p>
    </div>
  );
}
