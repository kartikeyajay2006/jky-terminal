import { useCallback, useEffect, useRef, useState } from "react";
import { GRID_ROWS, WEEKDAYS, monthGrid, monthLabel, nextMonth, prevMonth } from "./calendar";
import { describe as describeMoment } from "./eventTime";

/**
 * A date field that opens a calendar you can close.
 *
 * The native `<input type="date">` draws its picker outside the page, so
 * nothing here could put a close control on it — and it ignores the theme
 * entirely, which in a seven-theme app means a white box in a dark one.
 * Owning the picker fixes both.
 */
export function DatePicker({
  value,
  min,
  onChange,
  label = "Date",
  id,
}: {
  /** Local `YYYY-MM-DD`. */
  value: string;
  /** The earliest day that can be chosen, if any. */
  min?: string;
  onChange: (day: string) => void;
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const parsed = value.split("-").map(Number);
  const [shownYear, setShownYear] = useState(parsed[0] || new Date().getFullYear());
  const [shownMonth, setShownMonth] = useState(parsed[1] || new Date().getMonth() + 1);

  // Opening on a different month than the chosen date would hide the day the
  // user is looking for behind two clicks.
  useEffect(() => {
    const [y, m] = value.split("-").map(Number);
    if (y && m) {
      setShownYear(y);
      setShownMonth(m);
    }
  }, [value]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    // Focus goes back where it came from, or it lands on the document body
    // and the next Tab starts again from the top of the page.
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    }

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  const grid = monthGrid(shownYear, shownMonth);

  function choose(day: string) {
    onChange(day);
    close();
  }

  /** Arrow keys walk the grid, the way a calendar is expected to behave. */
  function onGridKey(e: React.KeyboardEvent, index: number) {
    const step =
      e.key === "ArrowLeft" ? -1
      : e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" ? -7
      : e.key === "ArrowDown" ? 7
      : 0;
    if (step === 0) return;

    e.preventDefault();
    const next = index + step;
    if (next < 0 || next >= grid.length) return;
    const cell = rootRef.current?.querySelectorAll<HTMLButtonElement>(".pick__day")[next];
    cell?.focus();
  }

  return (
    <div className="pick" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="input pick__trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value ? describeDay(value) : "Choose a date"}</span>
        <span className="pick__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="pick__pop" role="dialog" aria-label={`${label}: choose a day`}>
          <div className="pick__bar">
            <button
              type="button"
              className="cal__step"
              aria-label="Previous month"
              onClick={() => {
                const p = prevMonth(shownYear, shownMonth);
                setShownYear(p.year);
                setShownMonth(p.month);
              }}
            >
              ‹
            </button>
            <span className="pick__month" aria-live="polite">
              {monthLabel(shownYear, shownMonth)}
            </span>
            <button
              type="button"
              className="cal__step"
              aria-label="Next month"
              onClick={() => {
                const n = nextMonth(shownYear, shownMonth);
                setShownYear(n.year);
                setShownMonth(n.month);
              }}
            >
              ›
            </button>
            <button
              type="button"
              className="pick__close"
              aria-label="Close the calendar"
              onClick={() => close()}
            >
              ×
            </button>
          </div>

          <div className="pick__grid" role="grid" aria-label={monthLabel(shownYear, shownMonth)}>
            <div className="pick__weekdays" role="row">
              {WEEKDAYS.map((d) => (
                <span key={d} role="columnheader" className="cal__weekday">
                  {d}
                </span>
              ))}
            </div>

            {Array.from({ length: GRID_ROWS }, (_, row) => (
              <div key={row} className="pick__week" role="row">
                {grid.slice(row * 7, row * 7 + 7).map((cell, i) => {
                  const index = row * 7 + i;
                  // A day before the minimum cannot be chosen, and saying so
                  // by disabling it is clearer than accepting the click and
                  // then refusing on submit.
                  const tooEarly = min !== undefined && cell.date < min;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      role="gridcell"
                      className="pick__day"
                      disabled={tooEarly}
                      data-outside={!cell.inMonth || undefined}
                      data-today={cell.isToday || undefined}
                      aria-selected={cell.date === value}
                      aria-label={describeDay(cell.date)}
                      onKeyDown={(e) => onGridKey(e, index)}
                      onClick={() => choose(cell.date)}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="pick__hint">Press Esc to close</p>
        </div>
      )}
    </div>
  );
}

/** `Thu 27 Aug 2026`, with the time trimmed off. */
export function describeDay(day: string): string {
  return describeMoment(day, "12:00").replace(/, \d{2}:\d{2}$/, "");
}
