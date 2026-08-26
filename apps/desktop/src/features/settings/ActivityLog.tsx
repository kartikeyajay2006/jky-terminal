import { useCallback, useEffect, useState } from "react";
import { getPlatform, type AuditEvent } from "../../platform";
import { groupByDay, shapeOf, timeOf } from "./activityFormat";

/**
 * The activity log, rendered as a terminal stream.
 *
 * The underlying data is a JSONL file you could tail, and this looks like
 * tailing it — which is the honest presentation. A table would dress it up as
 * something more processed than it is.
 */
export function ActivityLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    void getPlatform()
      .readAudit()
      .then((all) => {
        setEvents(all);
        setFailed(false);
        setLoaded(true);
      })
      .catch(() => {
        setFailed(true);
        setLoaded(true);
      });
  }, []);

  useEffect(load, [load]);

  const groups = groupByDay(events);

  return (
    <section className="settings__section" aria-labelledby="activity-heading">
      <div className="activity__head">
        <h2 id="activity-heading">Activity</h2>
        <button type="button" className="btn" onClick={load}>
          Refresh
        </button>
      </div>

      <p className="hint">
        Every time your key is read, a tool runs, or a command is approved or
        declined, it is recorded here. The file sits beside your settings and
        can be read without this app.
      </p>

      {failed && (
        <p className="alert" role="alert">
          Could not read the activity log.
        </p>
      )}

      {loaded && !failed && events.length === 0 && (
        <p className="hint">Nothing recorded yet.</p>
      )}

      {groups.length > 0 && (
        <div className="stream" aria-label="Recorded activity">
          {groups.map((group) => (
            <div key={group.day} className="stream__day">
              <div className="stream__rule" aria-hidden="true">
                <span className="stream__label">{group.label}</span>
              </div>

              <ul className="stream__rows">
                {group.events.map((event, i) => {
                  const shape = shapeOf(event.kind);
                  return (
                    <li
                      key={`${event.at}-${i}`}
                      className="stream__row"
                      data-tone={shape.tone}
                    >
                      <span className="stream__time">{timeOf(event.at)}</span>
                      <span className="stream__glyph" aria-hidden="true">
                        {shape.glyph}
                      </span>
                      <span className="stream__kind">{shape.label}</span>
                      <span className="stream__detail">{event.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
