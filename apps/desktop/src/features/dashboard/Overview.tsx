import { useEffect, useState, type ReactNode } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard, newId, nowIso } from "./dashboardStore";
import type { DashPanel } from "./Dashboard";
import { GRID_ROWS, WEEKDAYS, monthGrid, monthLabel } from "./calendar";
import { byTimeOfDay, clockFromHhMm, clockTime, eventsOn, longDate, upcoming } from "./upcoming";
import {
  CARDS,
  defaultCardLayout,
  loadCardLayout,
  moveCard,
  restoreAllCards,
  saveCardLayout,
  setCardHidden,
  setCardSize,
  shownCards,
  type CardDef,
  type CardLayout,
  type CardSize,
} from "./cards";

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

  const [layout, setLayout] = useState<CardLayout>(loadCardLayout);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    saveCardLayout(layout);
  }, [layout]);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const grid = monthGrid(year, month, today);

  const latest = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const ahead = upcoming(events, today, 5);
  const openTodos = todos.filter((t) => !t.done);

  const newNote = () => {
    const now = nowIso();
    void saveNote({ id: newId("note"), title: "Untitled", body: "", created_at: now, updated_at: now });
    onOpen("notes");
  };

  /**
   * What each card holds.
   *
   * A switch rather than components stored on the registry, for the reason
   * the app registry gives: the registry is plain data read by tests and by
   * the editor, and React components in it would make it un-shareable for the
   * sake of saving this.
   */
  const body = (id: string): ReactNode => {
    switch (id) {
      case "calendar":
        return (
          <>
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
          </>
        );

      case "notes":
        return latest ? (
          <button type="button" className="card__open" onClick={() => onOpen("notes")}>
            <span className="card__note-title">{latest.title}</span>
            <span className="card__note-body">
              {latest.body.trim() || "Empty. Open it and start writing."}
            </span>
          </button>
        ) : (
          <p className="hint">Nothing written yet.</p>
        );

      case "reminders":
        return reminders.length === 0 ? (
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
        );

      case "events":
        return ahead.length === 0 ? (
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
        );

      case "todos":
        return todos.length === 0 ? (
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
        );

      case "quick":
        return (
          <div className="quick">
            <button type="button" className="quick__btn" onClick={newNote}>
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
          </div>
        );

      default:
        return null;
    }
  };

  /** The header action for a card, where it has one. */
  const action = (id: string) => {
    switch (id) {
      case "notes":
        return { label: "+ New note", onClick: newNote };
      case "calendar":
      case "events":
        return { label: "View all", onClick: () => onOpen("calendar") };
      case "reminders":
        return { label: "+ Add", onClick: () => onOpen("reminders") };
      case "todos":
        return { label: "+ Add", onClick: () => onOpen("todos") };
      default:
        return undefined;
    }
  };

  const shown = shownCards(layout);
  const hidden = layout.items.length - shown.length;

  return (
    <section className="panel panel--wide" aria-labelledby="overview-heading">
      <PanelHead
        where="Overview"
        headingId="overview-heading"
        status={<>{longDate(today.toISOString())}</>}
      />

      <div className="toolbar">
        <button
          type="button"
          className="tool"
          aria-pressed={editing}
          onClick={() => setEditing((on) => !on)}
        >
          {editing ? "Done" : "Edit board"}
        </button>
        {/* Offered whenever anything is hidden, in or out of edit mode: an
            emptied board with the way back only inside a mode you would have
            to guess at is a board you would clear storage to fix. */}
        {hidden > 0 && (
          <button
            type="button"
            className="tool"
            onClick={() => setLayout(restoreAllCards)}
          >
            Restore {hidden} hidden
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="tool tool--quiet"
            onClick={() => setLayout(defaultCardLayout())}
          >
            Reset
          </button>
        )}
      </div>

      <div
        className="grid"
        onDragOver={editing ? (e) => e.preventDefault() : undefined}
        onDrop={
          editing
            ? (e) => {
                e.preventDefault();
                if (dragging) setLayout((l) => moveCard(l, dragging, Number.MAX_SAFE_INTEGER));
                setDragging(null);
              }
            : undefined
        }
      >
        {shown.map((item, index) => {
          const def = CARDS.find((c) => c.id === item.id);
          if (!def) return null;
          return (
            <Card
              key={item.id}
              def={def}
              size={item.size}
              editing={editing}
              dragging={dragging === item.id}
              action={action(item.id)}
              onDragStart={() => setDragging(item.id)}
              onDragEnd={() => setDragging(null)}
              onDropHere={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragging) setLayout((l) => moveCard(l, dragging, index));
                setDragging(null);
              }}
              onResize={() =>
                setLayout((l) =>
                  setCardSize(
                    l,
                    item.id,
                    (item.size === "small"
                      ? "medium"
                      : item.size === "medium"
                        ? "large"
                        : "small") as CardSize,
                  ),
                )
              }
              onHide={() => setLayout((l) => setCardHidden(l, item.id, true))}
            >
              {body(item.id)}
            </Card>
          );
        })}

        {shown.length === 0 && (
          <p className="hint">
            Every card is hidden. Restore them above.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A widget.
 *
 * `tone` names one of the six event colours. Each card wearing its own means
 * you find the one you want by colour before you have read a single word,
 * which is the whole point of a grid of six.
 *
 * In edit mode it grows a size control and a hide control, and becomes
 * draggable. The controls sit in the header beside the card's own action
 * rather than in a strip of their own, because the header is already the
 * row of things you do to a card rather than in it.
 */
function Card({
  def,
  size,
  editing,
  dragging,
  action,
  onDragStart,
  onDragEnd,
  onDropHere,
  onResize,
  onHide,
  children,
}: {
  def: CardDef;
  size: CardSize;
  editing: boolean;
  dragging: boolean;
  action?: { label: string; onClick: () => void };
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: (e: React.DragEvent) => void;
  onResize: () => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className="card"
      data-tone={def.tone}
      data-size={size}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      aria-label={def.title}
      draggable={editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={editing ? (e) => e.preventDefault() : undefined}
      onDrop={editing ? onDropHere : undefined}
    >
      <header className="card__head">
        <span className="card__glyph" aria-hidden="true">
          {def.glyph}
        </span>
        <h3 className="card__title">{def.title}</h3>

        {editing ? (
          <span className="card__edit">
            <button
              type="button"
              className="pill"
              aria-label={`Size: ${size}`}
              onClick={onResize}
            >
              {size[0].toUpperCase()}
            </button>
            <button type="button" className="pill" aria-label="Hide card" onClick={onHide}>
              ◯
            </button>
          </span>
        ) : (
          action && (
            <button type="button" className="card__action" onClick={action.onClick}>
              [ {action.label} ]
            </button>
          )
        )}
      </header>
      <div className="card__body">{children}</div>
    </section>
  );
}
