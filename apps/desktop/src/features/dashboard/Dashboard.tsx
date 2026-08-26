import { useEffect, useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard } from "./dashboardStore";
import { Overview } from "./Overview";
import { NotesPanel } from "./NotesPanel";
import { TodosPanel } from "./TodosPanel";
import { CalendarPanel } from "./CalendarPanel";
import { RemindersPanel } from "./RemindersPanel";
import { EventsPanel } from "./EventsPanel";
import { MailAlertsPanel } from "./MailAlertsPanel";
import "./Dashboard.css";

export type DashPanel =
  | "overview"
  | "notes"
  | "todos"
  | "calendar"
  | "events"
  | "reminders"
  | "mail";

interface Section {
  id: DashPanel;
  label: string;
  glyph: string;
}

/** The sub-sections, in the order they appear down the side. */
export const SECTIONS: Section[] = [
  { id: "overview", label: "Overview", glyph: "◆" },
  { id: "notes", label: "Notes", glyph: "▤" },
  { id: "todos", label: "Todos", glyph: "☑" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "events", label: "Upcoming Events", glyph: "★" },
  { id: "reminders", label: "Reminders", glyph: "◔" },
  { id: "mail", label: "Mail Alerts", glyph: "✉" },
];

export function Dashboard() {
  const [panel, setPanel] = useState<DashPanel>("overview");
  const load = useDashboard((s) => s.load);

  // Loaded once for the whole dashboard, not per panel: every panel reads the
  // same collections, and re-fetching on each switch would make moving
  // between them flicker.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="dash">
      <nav className="dash__nav" aria-label="Dashboard sections">
        <h1 className="dash__title">Dashboard</h1>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="dash__link"
                aria-current={panel === s.id ? "page" : undefined}
                onClick={() => setPanel(s.id)}
              >
                <span className="dash__glyph" aria-hidden="true">
                  {s.glyph}
                </span>
                <span>{s.label}</span>
                <Count id={s.id} />
              </button>
            </li>
          ))}
        </ul>

        <p className="dash__note">
          Everything here stays until you delete it. Nothing is removed for
          being old.
        </p>
      </nav>

      <div className="dash__panel">
        {panel === "overview" && <Overview onOpen={setPanel} />}
        {panel === "notes" && <NotesPanel />}
        {panel === "todos" && <TodosPanel />}
        {panel === "calendar" && <CalendarPanel />}
        {panel === "events" && <EventsPanel />}
        {panel === "reminders" && <RemindersPanel />}
        {panel === "mail" && <MailAlertsPanel />}
      </div>
    </div>
  );
}

/** How many records a section holds, beside its name. */
function Count({ id }: { id: DashPanel }) {
  const notes = useDashboard((s) => s.notes.length);
  const todos = useDashboard((s) => s.todos.length);
  const events = useDashboard((s) => s.events.length);
  const reminders = useDashboard((s) => s.reminders.length);

  const n =
    id === "notes"
      ? notes
      : id === "todos"
        ? todos
        : id === "events" || id === "calendar"
          ? events
          : id === "reminders"
            ? reminders
            : null;

  // A zero is noise on a section you have not used yet.
  if (n === null || n === 0) return null;
  return <span className="dash__count">{n}</span>;
}

/** The shared masthead, so dashboard panels match the settings panels. */
export function DashHead({
  where,
  id,
  status,
  action,
}: {
  where: string;
  id: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <>
      <PanelHead where={where} headingId={id} status={status} />
      {action && <div className="dash__action">{action}</div>}
    </>
  );
}
