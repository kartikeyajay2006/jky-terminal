import { agoWords, KIND_GLYPH, type DueItem } from "./due";

/**
 * One notification, as it appears in both the banner and the centre.
 *
 * Shared so the two can never drift into looking like different features —
 * a banner sliding in and then the same thing sitting in the centre with a
 * different layout is the sort of small wrongness that reads as unfinished.
 */
export function NotificationRow({
  item,
  now,
  onDismiss,
  onComplete,
}: {
  item: DueItem;
  now: Date;
  onDismiss: () => void;
  /** Absent for events, which have nothing to tick off. */
  onComplete?: () => void;
}) {
  return (
    <div className="note-row" data-kind={item.kind} data-colour={item.colour}>
      <span className="note-row__icon" aria-hidden="true">
        {KIND_GLYPH[item.kind]}
      </span>

      <span className="note-row__body">
        <span className="note-row__title">{item.title}</span>
        <span className="note-row__meta">
          <span className="note-row__detail">{item.detail}</span>
          <span className="note-row__ago">{agoWords(now.getTime() - item.since)}</span>
        </span>
      </span>

      <span className="note-row__actions">
        {onComplete && (
          <button
            type="button"
            className="note-row__act note-row__act--done"
            aria-label={`Mark "${item.title}" done`}
            onClick={onComplete}
          >
            ✓
          </button>
        )}
        <button
          type="button"
          className="note-row__act note-row__act--close"
          aria-label={`Dismiss "${item.title}"`}
          onClick={onDismiss}
        >
          ×
        </button>
      </span>
    </div>
  );
}
