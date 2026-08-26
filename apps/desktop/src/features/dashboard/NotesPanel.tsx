import { useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard, newId, nowIso } from "./dashboardStore";
import { Empty } from "./Empty";
import type { Note } from "../../platform";

/**
 * Notes, in the shape of the assistant's conversation list: every saved note
 * down the side, one open in the editor.
 *
 * Nothing is pruned. The assistant keeps five conversations; this keeps every
 * note you have ever written until you delete it yourself.
 */
export function NotesPanel() {
  const notes = useDashboard((s) => s.notes);
  const error = useDashboard((s) => s.errors.notes);
  const saveNote = useDashboard((s) => s.saveNote);
  const deleteNote = useDashboard((s) => s.deleteNote);

  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const open = notes.find((n) => n.id === openId) ?? null;

  function create() {
    const now = nowIso();
    const note: Note = {
      id: newId("note"),
      title: "Untitled",
      body: "",
      created_at: now,
      updated_at: now,
    };
    setOpenId(note.id);
    void saveNote(note);
  }

  function edit(patch: Partial<Note>) {
    if (!open) return;
    void saveNote({ ...open, ...patch, updated_at: nowIso() });
  }

  return (
    <section className="panel" aria-labelledby="notes-heading">
      <PanelHead
        where="Notes"
        headingId="notes-heading"
        status={
          <>
            <b>{notes.length}</b> saved
          </>
        }
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="notes">
        <aside className="notes__list" aria-label="Saved notes">
          <button type="button" className="btn btn--primary notes__new" onClick={create}>
            + New note
          </button>

          {notes.length === 0 ? (
            <p className="hint notes__none">Nothing written yet.</p>
          ) : (
            <ul>
              {/* Most recently touched first: the one you want is almost
                  always the one you were just in. */}
              {[...notes]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      className="notes__link"
                      aria-current={note.id === openId ? "true" : undefined}
                      onClick={() => setOpenId(note.id)}
                    >
                      <span className="notes__link-title">{note.title}</span>
                      <span className="notes__link-when">{note.updated_at.slice(0, 10)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </aside>

        <div className="notes__editor">
          {open ? (
            <>
              <div className="notes__bar">
                <input
                  className="input notes__title"
                  aria-label="Note title"
                  value={open.title}
                  onChange={(e) => edit({ title: e.target.value })}
                />
                {confirming === open.id ? (
                  <span className="notes__confirm">
                    {/* A note is gone for good, so the second click is the
                        one that means it. */}
                    <span className="hint">Delete for good?</span>
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => {
                        void deleteNote(open.id);
                        setOpenId(null);
                        setConfirming(null);
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setConfirming(open.id)}
                  >
                    Delete
                  </button>
                )}
              </div>

              <div className="notes__paper">
                <div className="notes__gutter" aria-hidden="true">
                  {Array.from({ length: Math.max(open.body.split("\n").length, 12) }, (_, i) => (
                    <span key={i}>{i + 1}</span>
                  ))}
                </div>
                <textarea
                  className="notes__body"
                  aria-label="Note body"
                  spellCheck={false}
                  value={open.body}
                  placeholder="# Today's plan&#10;- …"
                  onChange={(e) => edit({ body: e.target.value })}
                />
              </div>
            </>
          ) : (
            <Empty
              glyph="▤"
              title="No note open"
              hint={
                notes.length === 0
                  ? "Start one with New note. It saves as you type."
                  : "Choose one from the list, or start a new one."
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}
