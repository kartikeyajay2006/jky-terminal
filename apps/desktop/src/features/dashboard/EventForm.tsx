import { useState } from "react";
import { EVENT_COLOURS, type Event, type EventColour } from "../../platform";
import { newId } from "./dashboardStore";

/**
 * Adding an event.
 *
 * The date and time inputs are local — that is what the person means — and
 * the value is converted to UTC on the way out, because the store keeps
 * instants and a local time on disk makes a laptop that crosses a timezone
 * start lying about when things happen.
 */
export function EventForm({
  day,
  onAdd,
}: {
  /** Prefills the date, when added from a calendar square. */
  day?: string;
  onAdd: (event: Event) => void;
}) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const localToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(day ?? localToday);
  const [time, setTime] = useState("09:00");
  const [colour, setColour] = useState<EventColour>("cyan");
  const [alert, setAlert] = useState<number | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    const local = new Date(`${date}T${time}`);
    if (Number.isNaN(local.getTime())) return;

    onAdd({
      id: newId("event"),
      title: t,
      // Seconds, no milliseconds: the shape the backend validates.
      starts_at: `${local.toISOString().slice(0, 19)}Z`,
      colour,
      alert_minutes_before: alert,
    });
    setTitle("");
  }

  return (
    <form className="eventform" onSubmit={submit}>
      <input
        className="input"
        aria-label="Event title"
        placeholder="Team meeting"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="input input--date"
        type="date"
        aria-label="Event date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        className="input input--time"
        type="time"
        aria-label="Event time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />

      <fieldset className="eventform__colours">
        <legend className="sr-only">Colour</legend>
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
      </fieldset>

      <label className="eventform__alert">
        <span className="sr-only">Email alert</span>
        <select
          className="input input--select"
          value={alert ?? ""}
          onChange={(e) => setAlert(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">No alert</option>
          <option value="30">30 min before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
        </select>
      </label>

      <button type="submit" className="btn btn--primary" disabled={!title.trim()}>
        Add event
      </button>
    </form>
  );
}
