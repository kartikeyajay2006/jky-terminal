import { useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard, newId } from "./dashboardStore";
import { Empty } from "./Empty";
import { byTimeOfDay, clockFromHhMm } from "./upcoming";

/**
 * A daily checklist, ordered by the clock rather than by when it was added.
 *
 * Times are a local wall clock: "07:00 morning exercise" means seven in the
 * morning wherever you are, unlike an event, which is a fixed instant.
 */
export function RemindersPanel() {
  const reminders = useDashboard((s) => s.reminders);
  const error = useDashboard((s) => s.errors.reminders);
  const saveReminder = useDashboard((s) => s.saveReminder);
  const deleteReminder = useDashboard((s) => s.deleteReminder);

  const [text, setText] = useState("");
  const [at, setAt] = useState("07:00");

  const done = reminders.filter((r) => r.done).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    void saveReminder({ id: newId("rem"), text: t, at, done: false });
    setText("");
  }

  return (
    <section className="panel" aria-labelledby="reminders-heading">
      <PanelHead
        where="Reminders"
        headingId="reminders-heading"
        status={
          reminders.length > 0 ? (
            <>
              <b>{done}</b> of {reminders.length} done
            </>
          ) : undefined
        }
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <form className="row-form" onSubmit={add}>
        <input
          className="input input--time"
          type="time"
          aria-label="Reminder time"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
        <input
          className="input"
          aria-label="New reminder"
          placeholder="Morning exercise"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {reminders.length === 0 ? (
        <Empty
          glyph="◔"
          title="No reminders yet"
          hint="Set a time and what it is for. These repeat every day."
        />
      ) : (
        <ul className="checklist" aria-label="Reminders">
          {byTimeOfDay(reminders).map((r) => (
            <li key={r.id} className="checklist__row" data-done={r.done || undefined}>
              <label className="checklist__check">
                <input
                  type="checkbox"
                  checked={r.done}
                  onChange={() => void saveReminder({ ...r, done: !r.done })}
                />
                <span className="checklist__when">{clockFromHhMm(r.at)}</span>
                <span className="checklist__text">{r.text}</span>
              </label>
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Remove ${r.text}`}
                onClick={() => void deleteReminder(r.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
