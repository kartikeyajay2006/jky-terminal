import { MAX_SESSIONS, useChat } from "../../app/chatStore";

export function SessionList() {
  const sessions = useChat((s) => s.sessions);
  const activeId = useChat((s) => s.activeId);
  const newSession = useChat((s) => s.newSession);
  const switchTo = useChat((s) => s.switchTo);
  const deleteSession = useChat((s) => s.deleteSession);

  return (
    <aside className="sessions" aria-label="Conversations">
      <div className="sessions__head">
        <span className="sessions__title">Conversations</span>
        <button type="button" className="sessions__new" onClick={() => newSession()}>
          + New
        </button>
      </div>

      <ul className="sessions__list">
        {/* Newest first: the one you want is almost always the last one. */}
        {[...sessions].reverse().map((session) => (
          <li key={session.id} className="sessions__row">
            <button
              type="button"
              className="sessions__link"
              aria-current={session.id === activeId ? "true" : undefined}
              onClick={() => switchTo(session.id)}
            >
              {session.title}
            </button>
            <button
              type="button"
              className="sessions__delete"
              aria-label={`Delete ${session.title}`}
              onClick={() => deleteSession(session.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <p className="sessions__note">
        The {MAX_SESSIONS} most recent are kept. Older ones are removed
        automatically.
      </p>
    </aside>
  );
}
