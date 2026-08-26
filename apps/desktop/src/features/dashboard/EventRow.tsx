import type { Event } from "../../platform";
import { clockTime, longDate } from "./upcoming";

export function EventRow({ event, onDelete }: { event: Event; onDelete: () => void }) {
  return (
    <li className="event">
      <span className="dot" data-colour={event.colour} aria-hidden="true" />
      <span className="event__date">{longDate(event.starts_at)}</span>
      <span className="event__time">{clockTime(event.starts_at)}</span>
      <span className="event__title">{event.title}</span>
      {event.alert_minutes_before !== null && (
        <span className="event__alert" title="Email alert">
          ✉ {formatLead(event.alert_minutes_before)}
        </span>
      )}
      <button
        type="button"
        className="event__remove"
        aria-label={`Remove ${event.title}`}
        onClick={onDelete}
      >
        ×
      </button>
    </li>
  );
}

/** `30m`, `1h`, `1d` — short enough to sit at the end of a row. */
export function formatLead(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
