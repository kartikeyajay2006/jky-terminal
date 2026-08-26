import { PanelHead } from "../settings/PanelHead";
import { useDashboard, newId, nowIso } from "./dashboardStore";
import type { DashPanel } from "./Dashboard";
import { GRID_ROWS, WEEKDAYS, monthGrid, monthLabel } from "./calendar";
import { byTimeOfDay, clockFromHhMm, clockTime, eventsOn, longDate, upcoming } from "./upcoming";

/**
 * The widget grid.
 *
 * Every card is a live view of the same collections the dedicated panels
 * write to — not a copy — so a todo ticked here is ticked there.
 */
export function Overview({ onOpen }: { onOpen: (panel: DashPanel) => void }) {
  const notes = useDashboard((s) => s.notes);
  const todos = useDashboard((s) => s.todos);
  const events = useDashboard((s) => s.events);
  const reminders = useDashboard((s) => s.reminders);
  const saveNote = useDashboard((s) => s.saveNote);
  const saveTodo = useDashboard((s) => s.saveTodo);
  const saveReminder = useDashboard((s) => s.saveReminder);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const grid = monthGrid(year, month, today);

  const latest = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const ahead = upcoming(events, today, 5);
  const openTodos = todos.filter((t) => !t.done);

  return (
    <section className="panel panel--wide" aria-labelledby="overview-heading">
      <PanelHead
        where="Overview"
        headingId="overview-heading"
        status={<>{longDate(today.toISOString())}</>}
      />

      <div className="grid">
        <Card title="Notes" glyph="▤" action={{ label: "+ New note", onClick: () => {
          const now = nowIso();
          void saveNote({ id: newId("note"), title: "Untitled", body: "", created_at: now, updated_at: now });
          onOpen("notes");
        } }}>
          {latest ? (
            <button type="button" className="card__open" onClick={() => onOpen("notes")}>
              <span className="card__note-title">{latest.title}</span>
              <span className="card__note-body">
                {latest.body.trim() || "Empty. Open it and start writing."}
              </span>
            </button>
          ) : (
            <p className="hint">Nothing written yet.</p>
          )}
        </Card>

        <Card title="Calendar" glyph="▦" action={{ label: "View all", onClick: () => onOpen("calendar") }}>
          <p className="card__month">{monthLabel(year, month)}</p>
          <div className="cal__grid cal__grid--mini">
            <div className="cal__weekdays">
              {WEEKDAYS.map((d) => (
                <span key={d} className="cal__weekday">
                  {d}
                </span>
              ))}
            </div>
            {Array.from({ length: GRID_ROWS }, (_, row) => (
              <div key={row} className="cal__week">
                {grid.slice(row * 7, row * 7 + 7).map((cell) => (
                  <span
                    key={cell.date}
                    className="cal__day cal__day--mini"
                    data-outside={!cell.inMonth || undefined}
                    data-today={cell.isToday || undefined}
                    data-has={eventsOn(events, cell.date).length > 0 || undefined}
                  >
                    {cell.day}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Reminders" glyph="◔" action={{ label: "+ Add", onClick: () => onOpen("reminders") }}>
          {reminders.length === 0 ? (
            <p className="hint">None set.</p>
          ) : (
            <ul className="checklist checklist--tight">
              {byTimeOfDay(reminders).slice(0, 8).map((r) => (
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
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming Events" glyph="★" action={{ label: "View all", onClick: () => onOpen("events") }}>
          {ahead.length === 0 ? (
            <p className="hint">Nothing scheduled.</p>
          ) : (
            <ul className="events events--compact">
              {ahead.map((e) => (
                <li key={e.id} className="event">
                  <span className="dot" data-colour={e.colour} aria-hidden="true" />
                  <span className="event__date">{longDate(e.starts_at)}</span>
                  <span className="event__time">{clockTime(e.starts_at)}</span>
                  <span className="event__title">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Todos" glyph="☑" action={{ label: "+ Add", onClick: () => onOpen("todos") }}>
          {todos.length === 0 ? (
            <p className="hint">Nothing on the list.</p>
          ) : (
            <ul className="checklist checklist--tight">
              {openTodos.slice(0, 8).map((t) => (
                <li key={t.id} className="checklist__row">
                  <label className="checklist__check">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => void saveTodo({ ...t, done: !t.done })}
                    />
                    <span className="checklist__text">{t.text}</span>
                  </label>
                </li>
              ))}
              {openTodos.length === 0 && <li className="hint">All done.</li>}
            </ul>
          )}
        </Card>

        <Card title="Quick Actions" glyph="⚡">
          <div className="quick">
            <button type="button" className="quick__btn" onClick={() => {
              const now = nowIso();
              void saveNote({ id: newId("note"), title: "Untitled", body: "", created_at: now, updated_at: now });
              onOpen("notes");
            }}>
              <span aria-hidden="true">+</span> New Note
            </button>
            <button type="button" className="quick__btn" onClick={() => onOpen("calendar")}>
              <span aria-hidden="true">+</span> Add Event
            </button>
            <button type="button" className="quick__btn" onClick={() => onOpen("reminders")}>
              <span aria-hidden="true">+</span> Add Reminder
            </button>
            <button type="button" className="quick__btn" onClick={() => onOpen("todos")}>
              <span aria-hidden="true">+</span> Add Todo
            </button>
            <button type="button" className="quick__btn" onClick={() => onOpen("mail")}>
              <span aria-hidden="true">✉</span> Mail Alerts
            </button>
          </div>
        </Card>
      </div>
    </section>
  );
}

function Card({
  title,
  glyph,
  action,
  children,
}: {
  title: string;
  glyph: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <header className="card__head">
        <span className="card__glyph" aria-hidden="true">
          {glyph}
        </span>
        <h3 className="card__title">{title}</h3>
        {action && (
          <button type="button" className="card__action" onClick={action.onClick}>
            [ {action.label} ]
          </button>
        )}
      </header>
      <div className="card__body">{children}</div>
    </section>
  );
}
