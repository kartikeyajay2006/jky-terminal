import { useEffect } from "react";
import type { Entry, Meter, Recognised, Row, Column, View } from "./recognise";

/**
 * What a command turned out to be.
 *
 * Appears under the terminal when a finished command's output was recognised
 * as something with a shape — a table, a set of proportions, a history. The
 * text output is untouched and still above it: this is an extra view of the
 * same thing, never a replacement, and it can be dismissed.
 *
 * Every action **types a command into the terminal**. Nothing here runs
 * anything on its own, which is the whole safety model — a panel that could
 * quietly `docker stop` would be one you had to trust, and this one only has
 * to be read. You still press Enter.
 */
export function CommandApp({
  found,
  onRun,
  onDismiss,
}: {
  found: Recognised;
  /** Types a command into the terminal. Does not execute it. */
  onRun: (command: string) => void;
  onDismiss: () => void;
}) {
  const actions = found.actions ?? [];

  // The keys shown beside each action, and Escape — a terminal is a keyboard
  // before it is anything else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Not while something is being typed into: a panel that swallowed "a"
      // would make every input in it unusable.
      const into = e.target as HTMLElement | null;
      if (into && /^(input|textarea|select)$/i.test(into.tagName)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      const chosen = actions.find((a) => a.key === e.key);
      if (chosen) {
        e.preventDefault();
        onRun(chosen.command);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, onRun, onDismiss]);

  return (
    <section className="capp" role="group" aria-label={found.title}>
      <header className="capp__head">
        <span className="capp__mark" aria-hidden="true" />
        <h2 className="capp__title">{found.title}</h2>
        {found.subtitle && <span className="capp__sub">{found.subtitle}</span>}
        <button type="button" className="capp__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </header>

      <div className="capp__body">
        <Body view={found.view} title={found.title} />
      </div>

      {actions.length > 0 && (
        <footer className="capp__actions">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="capp__action"
              onClick={() => onRun(action.command)}
            >
              <span className="capp__key" aria-hidden="true">
                {action.key}
              </span>
              {action.label}
            </button>
          ))}
          <span className="capp__hint">Actions type the command — you still press Enter.</span>
        </footer>
      )}
    </section>
  );
}

function Body({ view, title }: { view: View; title: string }) {
  switch (view.kind) {
    case "table":
      return <Table columns={view.columns} rows={view.rows} title={title} />;
    case "meters":
      return <Meters meters={view.meters} />;
    case "timeline":
      return <Timeline entries={view.entries} />;
    case "facts":
      return (
        <dl className="capp__facts">
          {view.facts.map((fact, i) => (
            <div className="capp__fact" key={`${fact.label}-${i}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "json":
      // A `pre`, and never `dangerouslySetInnerHTML`. This text came out of a
      // command, which is to say from anywhere at all.
      return <pre className="capp__json">{view.text}</pre>;
  }
}

function Table({ columns, rows, title }: { columns: Column[]; rows: Row[]; title: string }) {
  return (
    <table className="capp__table" aria-label={title}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              data-align={column.align}
              data-secondary={column.secondary || undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-tone={row.tone}>
            {columns.map((column) => (
              <td
                key={column.key}
                data-align={column.align}
                data-mono={column.mono || undefined}
                data-secondary={column.secondary || undefined}
              >
                {row.cells[column.key] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Meters({ meters }: { meters: Meter[] }) {
  return (
    <div className="capp__meters">
      {meters.map((meter) => {
        const share = meter.total > 0 ? Math.min(100, (meter.used / meter.total) * 100) : 0;
        return (
          <div className="capp__meter" key={meter.label}>
            <span className="capp__meter-label">
              {meter.label}
              {meter.note && <span className="capp__meter-note">{meter.note}</span>}
            </span>
            <span className="capp__meter-figure">
              {meter.usedText} / {meter.totalText} · {Math.round(share)}%
            </span>
            <span className="capp__bar" aria-hidden="true">
              <span
                className="capp__bar-fill"
                style={{ width: `${share}%` }}
                data-hot={share >= 85 || undefined}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <ol className="capp__timeline">
      {entries.map((entry) => (
        <li className="capp__entry" key={entry.id}>
          <span className="capp__dot" aria-hidden="true" />
          <span className="capp__entry-title">{entry.title}</span>
          <span className="capp__entry-meta">
            {entry.meta.map((bit, i) => (
              <span key={i}>{bit}</span>
            ))}
          </span>
          {entry.body && <p className="capp__entry-body">{entry.body}</p>}
        </li>
      ))}
    </ol>
  );
}
