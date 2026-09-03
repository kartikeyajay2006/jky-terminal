import { useCallback, useEffect, useState } from "react";
import { fromTerminal } from "./FailureHelp";
import type { Chip, Column, Entry, Meter, Recognised, Row, View } from "./recognise";

/**
 * What a command turned out to be.
 *
 * Appears under the terminal when a finished command's output was recognised
 * as something with a shape. The text output is untouched and still above it:
 * this is an extra view of the same thing, never a replacement, and it can be
 * dismissed.
 *
 * Every action **types a command into the terminal**. Nothing here runs
 * anything on its own, which is the whole safety model — a panel that could
 * quietly `docker stop` would be one you had to trust, and this one only has
 * to be read. You still press Enter.
 *
 * Each kind carries its own colour and glyph, so a panel is recognisable
 * before its heading is read. That is the same wayfinding the Apps grid and
 * the dashboard cards use, and for the same reason.
 */
export function CommandApp({
  found,
  command,
  onRun,
  onDismiss,
  claimKeys,
}: {
  found: Recognised;
  /** The command that produced it, shown so the panel is anchored to it. */
  command?: string;
  /** Types a command into the terminal. Does not execute it. */
  onRun: (command: string) => void;
  onDismiss: () => void;
  /** Lends this panel the terminal's keyboard while it is open. */
  claimKeys?: (handler: ((event: KeyboardEvent) => boolean) | null) => void;
}) {
  const actions = found.actions ?? [];
  const [tall, setTall] = useState(false);

  /**
   * The keys shown beside each action, and Escape.
   *
   * Reached two ways, as in `FailureHelp`: through the claim when the
   * terminal has focus — the only place a key can be taken before the shell
   * is sent it — and on the window when focus is on the panel itself.
   */
  const handleKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;

      if (e.key === "Escape") {
        onDismiss();
        return true;
      }
      const chosen = actions.find((a) => a.key === e.key);
      if (chosen) {
        onRun(chosen.command);
        return true;
      }
      return false;
    },
    [actions, onRun, onDismiss],
  );

  useEffect(() => {
    claimKeys?.(handleKey);
    return () => claimKeys?.(null);
  }, [claimKeys, handleKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (fromTerminal(e)) return;
      // Not while something is being typed into: a panel that swallowed "a"
      // would make every field in it unusable.
      const into = e.target as HTMLElement | null;
      if (into && /^(input|textarea|select)$/i.test(into.tagName)) return;
      if (handleKey(e)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKey]);

  return (
    <section
      className="capp"
      role="group"
      aria-label={found.title}
      data-tall={tall || undefined}
      // Set as a variable rather than a class per kind, so a recogniser added
      // later is a registry entry and never a new stylesheet rule.
      style={{ ["--capp-accent" as string]: `var(--${found.accent})` }}
    >
      <header className="capp__head">
        <span className="capp__glyph" aria-hidden="true">
          {found.glyph}
        </span>

        <div className="capp__who">
          <h2 className="capp__title">{found.title}</h2>
          {found.subtitle && <span className="capp__sub">{found.subtitle}</span>}
        </div>

        {found.chips && found.chips.length > 0 && (
          <div className="capp__chips">
            {found.chips.map((chip: Chip) => (
              <span key={chip.text} className="capp__chip" data-tone={chip.tone}>
                {chip.text}
              </span>
            ))}
          </div>
        )}

        {/* The command that produced this, so the panel is anchored to what
            you typed rather than floating above it. */}
        {command && (
          <code className="capp__command" title={command}>
            <span className="capp__prompt" aria-hidden="true">
              $
            </span>
            {command}
          </code>
        )}

        {/*
          One cell, not two: the head declares four columns, and a fifth child
          would be placed in an implicit column of its own.

          The glyphs are written as the characters they are. A `\u` escape is
          processed inside a JavaScript string and *not* in JSX text, so one
          written as text renders as the six characters you typed — which is
          exactly what the dismiss button did until someone read it.
        */}
        <span className="capp__tools">
          <button
            type="button"
            className="capp__icon"
            aria-label={tall ? "Shrink" : "Grow"}
            title={tall ? "Shrink" : "Grow"}
            aria-pressed={tall}
            onClick={() => setTall((on) => !on)}
          >
            {tall ? "⤡" : "⤢"}
          </button>
          <button
            type="button"
            className="capp__icon"
            aria-label="Dismiss"
            title="Dismiss (Esc)"
            onClick={onDismiss}
          >
            ×
          </button>
        </span>
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
              <code className="capp__action-cmd">{action.command}</code>
            </button>
          ))}
          <span className="capp__hint">These type the command — you still press Enter.</span>
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
      return <Facts facts={view.facts} />;
    case "json":
      // A `pre`, and never `dangerouslySetInnerHTML`. This text came out of a
      // command, which is to say from anywhere at all.
      return <pre className="capp__json">{view.text}</pre>;
  }
}

function Table({ columns, rows, title }: { columns: Column[]; rows: Row[]; title: string }) {
  const toned = rows.some((row) => row.tone);

  return (
    <table className="capp__table" aria-label={title}>
      <thead>
        <tr>
          {/* The dot column has no heading: it repeats what the status column
              already says, and a screen reader should hear it once. */}
          {toned && <th scope="col" className="capp__dot-head" />}
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
            {toned && (
              <td className="capp__dot-cell">
                <span className="capp__row-dot" aria-hidden="true" />
              </td>
            )}
            {columns.map((column) => (
              <td
                key={column.key}
                data-align={column.align}
                data-mono={column.mono || undefined}
                data-secondary={column.secondary || undefined}
              >
                {column.as === "status" && row.cells[column.key] ? (
                  <span className="capp__status">{row.cells[column.key]}</span>
                ) : (
                  (row.cells[column.key] ?? "")
                )}
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
          <div className="capp__meter" key={meter.label} data-hot={share >= 85 || undefined}>
            <span className="capp__meter-label">
              {meter.label}
              {meter.note && <span className="capp__meter-note">{meter.note}</span>}
            </span>
            {/* The percentage large, because ranking four disks is the whole
                reason anyone typed df. */}
            <span className="capp__meter-pct">{Math.round(share)}%</span>
            <span className="capp__meter-figure">
              {meter.usedText} of {meter.totalText}
            </span>
            <span className="capp__bar" aria-hidden="true">
              <span className="capp__bar-fill" style={{ width: `${share}%` }} />
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
      {entries.map((entry) => {
        const [sha, ...rest] = entry.meta;
        return (
          <li className="capp__entry" key={entry.id}>
            <span className="capp__dot" aria-hidden="true" />
            <span className="capp__entry-title">{entry.title}</span>
            <span className="capp__entry-meta">
              {sha && <code className="capp__sha">{sha}</code>}
              {rest.map((bit, i) => (
                <span key={i}>{bit}</span>
              ))}
            </span>
            {entry.body && <p className="capp__entry-body">{entry.body}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Facts, with the first one given the weight it deserves.
 *
 * `mkdir project_name` has one thing worth reading and three worth having,
 * and a flat list of four would bury it.
 */
function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  const [lead, ...rest] = facts;
  return (
    <div className="capp__facts">
      {lead && (
        <p className="capp__lead">
          <span className="capp__lead-label">{lead.label}</span>
          <span className="capp__lead-value">{lead.value}</span>
        </p>
      )}
      {rest.length > 0 && (
        <dl className="capp__fact-list">
          {rest.map((fact, i) => (
            <div className="capp__fact" key={`${fact.label}-${i}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
