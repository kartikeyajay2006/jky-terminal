import { useEffect, useState } from "react";
import { useChat } from "../../app/chatStore";

/**
 * The bar above a conversation: what it is, and how to get rid of it.
 *
 * Delete is two clicks rather than one. A conversation is cheap to lose but
 * annoying to lose by accident, and a modal for something this small would be
 * heavier than the action deserves.
 */
export function ConversationHeader() {
  const sessions = useChat((s) => s.sessions);
  const activeId = useChat((s) => s.activeId);
  const deleteSession = useChat((s) => s.deleteSession);
  const clearSession = useChat((s) => s.clearSession);

  const session = sessions.find((s) => s.id === activeId);
  const [confirming, setConfirming] = useState(false);

  // Arming a delete on one conversation and then switching to another must
  // not leave the new one armed.
  useEffect(() => setConfirming(false), [activeId]);

  if (!session) return null;

  return (
    <header className="convo">
      <span className="convo__title" title={session.title}>
        {session.title}
      </span>

      <div className="convo__actions">
        {session.turns.length > 0 && !confirming && (
          <button
            type="button"
            className="convo__action"
            onClick={() => clearSession(session.id)}
          >
            Clear
          </button>
        )}

        {confirming ? (
          <>
            <span className="convo__ask">Delete this conversation?</span>
            <button
              type="button"
              className="convo__action convo__action--danger"
              onClick={() => deleteSession(session.id)}
            >
              Delete
            </button>
            <button
              type="button"
              className="convo__action"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="convo__action convo__action--danger"
            onClick={() => setConfirming(true)}
          >
            Delete conversation
          </button>
        )}
      </div>
    </header>
  );
}
