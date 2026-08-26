import { useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard } from "./dashboardStore";
import { EventForm } from "./EventForm";
import { EventRow } from "./EventRow";
import { GRID_ROWS, WEEKDAYS, localDay, monthGrid, monthLabel, nextMonth, prevMonth } from "./calendar";
import { eventsOn } from "./upcoming";

export function CalendarPanel() {
  const events = useDashboard((s) => s.events);
  const error = useDashboard((s) => s.errors.events);
  const saveEvent = useDashboard((s) => s.saveEvent);
  const deleteEvent = useDashboard((s) => s.deleteEvent);

  const today = new Date();
  const [at, setAt] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selected, setSelected] = useState<string>(localDay(today));

  const grid = monthGrid(at.year, at.month, today);
  const onSelected = eventsOn(events, selected);

  return (
    <section className="panel" aria-labelledby="calendar-heading">
      <PanelHead
        where="Calendar"
        headingId="calendar-heading"
        status={
          events.length > 0 ? (
            <>
              <b>{events.length}</b> events
            </>
          ) : undefined
        }
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="cal">
        <div className="cal__bar">
          <button
            type="button"
            className="cal__step"
            aria-label="Previous month"
            onClick={() => setAt(prevMonth(at.year, at.month))}
          >
            ‹
          </button>
          {/* aria-live so paging with the keyboard announces where you are. */}
          <h3 className="cal__month" aria-live="polite">
            {monthLabel(at.year, at.month)}
          </h3>
          <button
            type="button"
            className="cal__step"
            aria-label="Next month"
            onClick={() => setAt(nextMonth(at.year, at.month))}
          >
            ›
          </button>
        </div>

        <div className="cal__grid" role="grid" aria-label={monthLabel(at.year, at.month)}>
          <div className="cal__weekdays" role="row">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader" className="cal__weekday">
                {d}
              </span>
            ))}
          </div>

          {Array.from({ length: GRID_ROWS }, (_, row) => (
            <div key={row} className="cal__week" role="row">
              {grid.slice(row * 7, row * 7 + 7).map((cell) => {
                const on = eventsOn(events, cell.date);
                return (
                  <button
                    key={cell.date}
                    type="button"
                    role="gridcell"
                    className="cal__day"
                    data-outside={!cell.inMonth || undefined}
                    data-today={cell.isToday || undefined}
                    aria-selected={cell.date === selected}
                    aria-label={`${cell.date}${on.length ? `, ${on.length} events` : ""}`}
                    onClick={() => setSelected(cell.date)}
                  >
                    <span className="cal__num">{cell.day}</span>
                    {on.length > 0 && (
                      <span className="cal__dots" aria-hidden="true">
                        {/* Three at most: beyond that the squares fill up and
                            the number stops meaning anything at a glance. */}
                        {on.slice(0, 3).map((e) => (
                          <span key={e.id} className="dot dot--sm" data-colour={e.colour} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cal__day-detail">
          <h3 className="dash__subhead">{selected}</h3>
          {onSelected.length === 0 ? (
            <p className="hint">Nothing on this day.</p>
          ) : (
            <ul className="events" aria-label={`Events on ${selected}`}>
              {onSelected.map((e) => (
                <EventRow key={e.id} event={e} onDelete={() => void deleteEvent(e.id)} />
              ))}
            </ul>
          )}
          <EventForm day={selected} onAdd={(e) => void saveEvent(e)} />
        </div>
      </div>
    </section>
  );
}
