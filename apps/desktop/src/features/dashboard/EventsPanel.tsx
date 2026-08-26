import { PanelHead } from "../settings/PanelHead";
import { useDashboard } from "./dashboardStore";
import { EventForm } from "./EventForm";
import { EventRow } from "./EventRow";
import { Empty } from "./Empty";
import { past, upcoming } from "./upcoming";

export function EventsPanel() {
  const events = useDashboard((s) => s.events);
  const error = useDashboard((s) => s.errors.events);
  const saveEvent = useDashboard((s) => s.saveEvent);
  const deleteEvent = useDashboard((s) => s.deleteEvent);

  const ahead = upcoming(events);
  const behind = past(events);

  return (
    <section className="panel" aria-labelledby="events-heading">
      <PanelHead
        where="Upcoming Events"
        headingId="events-heading"
        status={
          events.length > 0 ? (
            <>
              <b>{ahead.length}</b> ahead
            </>
          ) : undefined
        }
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <EventForm onAdd={(e) => void saveEvent(e)} />

      {events.length === 0 ? (
        <Empty
          glyph="★"
          title="Nothing scheduled"
          hint="Add an event above. Give it an alert and you will get an email before it."
        />
      ) : (
        <>
          <h3 className="dash__subhead">Ahead</h3>
          {ahead.length === 0 ? (
            <p className="hint">Nothing ahead. Everything below has been and gone.</p>
          ) : (
            <ul className="events" aria-label="Upcoming events">
              {ahead.map((e) => (
                <EventRow key={e.id} event={e} onDelete={() => void deleteEvent(e.id)} />
              ))}
            </ul>
          )}

          {behind.length > 0 && (
            <>
              {/* Past events stay. They are a record of what happened, and
                  removing them would be the app deciding for you. */}
              <h3 className="dash__subhead">Been and gone</h3>
              <ul className="events events--past" aria-label="Past events">
                {behind.map((e) => (
                  <EventRow key={e.id} event={e} onDelete={() => void deleteEvent(e.id)} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
