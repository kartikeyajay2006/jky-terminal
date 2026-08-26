import { PanelHead } from "../settings/PanelHead";
import { useDashboard } from "./dashboardStore";
import { formatLead } from "./EventRow";
import { upcoming } from "./upcoming";

/**
 * Mail alerts, before the delivery half exists.
 *
 * The events already carry their lead times, so this shows exactly what is
 * set up and states plainly what does not work yet. An empty panel promising
 * a feature would be worse than one that says where the work has got to.
 */
export function MailAlertsPanel() {
  const events = useDashboard((s) => s.events);
  const armed = upcoming(events).filter((e) => e.alert_minutes_before !== null);

  return (
    <section className="panel" aria-labelledby="mail-heading">
      <PanelHead
        where="Mail Alerts"
        headingId="mail-heading"
        status={
          armed.length > 0 ? (
            <>
              <b>{armed.length}</b> set
            </>
          ) : undefined
        }
      />

      <div className="notice">
        <span className="notice__glyph" aria-hidden="true">
          ✉
        </span>
        <div>
          <p>
            <strong>Delivery is not built yet.</strong> You can set a lead time
            on any event now and it is stored with it, but no email is sent.
          </p>
          <p>
            When it lands, a small helper registered with your operating system
            will send the mail even while JKY Terminal is closed — a systemd
            user timer on Linux, a LaunchAgent on macOS, a Task Scheduler entry
            on Windows. None of them needs administrator rights, and turning
            alerts off removes it.
          </p>
          <p>
            It cannot send anything while your computer is off. Nothing running
            on your machine can. That would need a server holding your mail
            credentials, which this app does not have and will not ask for.
          </p>
        </div>
      </div>

      <h3 className="dash__subhead">Alerts you have set</h3>
      {armed.length === 0 ? (
        <p className="hint">
          None yet. Add an event under Calendar or Upcoming Events and choose a
          lead time.
        </p>
      ) : (
        <ul className="events" aria-label="Events with alerts">
          {armed.map((e) => (
            <li key={e.id} className="event">
              <span className="dot" data-colour={e.colour} aria-hidden="true" />
              <span className="event__title">{e.title}</span>
              <span className="event__alert">
                ✉ {formatLead(e.alert_minutes_before ?? 0)} before
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
