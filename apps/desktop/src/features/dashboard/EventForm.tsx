import { useEffect, useState } from "react";
import { EVENT_COLOURS, type Event, type EventColour } from "../../platform";
import { newId } from "./dashboardStore";
import { DatePicker } from "./DatePicker";
import { defaultWhen, describe, localDate, relative, toInstant, whyNot } from "./eventTime";

const LEADS = [
  { value: "", label: "No alert" },
  { value: "30", label: "Notify 30 min before" },
  { value: "60", label: "Notify 1 hour before" },
  { value: "1440", label: "Notify 1 day before" },
];

/**
 * Adding an event.
 *
 * The date and time are entered on the local clock — that is what a person
 * means — and converted to a UTC instant on the way out, because the store
 * keeps instants and a local time on disk makes a laptop that crosses a
 * timezone start lying about when things happen.
 */
export function EventForm({
  day,
  onAdd,
}: {
  /** The calendar day to fill in, when adding from a square. */
  day?: string;
  onAdd: (event: Event) => void;
}) {
  const now = new Date();
  const today = localDate(now);
  const opening = defaultWhen(now);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(day ?? opening.date);
  const [time, setTime] = useState(opening.time);
  const [colour, setColour] = useState<EventColour>("cyan");
  const [alert, setAlert] = useState<number | null>(null);
  const [tried, setTried] = useState(false);

  // Follow the calendar. useState only reads its argument on the first
  // render, so without this the form kept whichever day happened to be
  // selected when it mounted and every later click did nothing.
  useEffect(() => {
    if (day) setDate(day);
  }, [day]);

  const problem = whyNot(date, time);
  const ready = title.trim().length > 0 && problem === null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);

    const t = title.trim();
    const instant = toInstant(date, time);
    if (!t || problem !== null || !instant) return;

    onAdd({
      id: newId("event"),
      title: t,
      starts_at: instant,
      colour,
      alert_minutes_before: alert,
    });
    setTitle("");
    setTried(false);
  }

  return (
    <form className="eventform" onSubmit={submit} noValidate>
      <div className="field-row">
        <label className="field-cell field-cell--grow">
          <span className="field-cell__label">Event</span>
          <input
            className="input"
            aria-label="Event title"
            placeholder="Team meeting"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="field-cell">
          <span className="field-cell__label" id="event-date-label">
            Date
          </span>
          {/* Our own picker rather than the native one: it can be closed with
              a button and with Esc, and it wears the app's theme. */}
          <DatePicker
            value={date}
            min={today}
            label="Event date"
            onChange={setDate}
          />
        </div>

        <label className="field-cell">
          <span className="field-cell__label">Time</span>
          <input
            className="input input--time"
            type="time"
            aria-label="Event time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
      </div>

      <div className="field-row">
        <div className="field-cell">
          <span className="field-cell__label" id="event-colour-label">
            Colour
          </span>
          <div
            className="eventform__colours"
            role="radiogroup"
            aria-labelledby="event-colour-label"
          >
            {EVENT_COLOURS.map((c) => (
              <label key={c} className="dot-choice">
                <input
                  type="radio"
                  name="event-colour"
                  value={c}
                  checked={colour === c}
                  onChange={() => setColour(c)}
                />
                <span className="dot" data-colour={c} aria-hidden="true" />
                <span className="sr-only">{c}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="field-cell field-cell--grow">
          <span className="field-cell__label">Alert</span>
          <select
            className="input input--select"
            aria-label="Alert"
            value={alert ?? ""}
            onChange={(e) => setAlert(e.target.value === "" ? null : Number(e.target.value))}
          >
            {LEADS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="btn btn--primary eventform__go" disabled={!ready}>
          Add event
        </button>
      </div>

      {/* What the two boxes actually add up to. Without it a wrong month is
          invisible until the event turns up in the wrong place. */}
      <p className="eventform__when" data-bad={problem !== null || undefined}>
        {problem ? (
          <>
            <span aria-hidden="true">⚠ </span>
            {/* Announced only once the user has tried, so it does not read
                out on every keystroke while they are still choosing. */}
            <span role={tried ? "alert" : undefined}>{problem}</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">→ </span>
            {describe(date, time)}
            <span className="eventform__rel"> · {relative(date, time)}</span>
          </>
        )}
      </p>
    </form>
  );
}
