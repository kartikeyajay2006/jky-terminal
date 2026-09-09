import { useEffect, useRef } from "react";
import "./UnsavedDialog.css";

export type Answer = "save" | "discard" | "cancel";

/**
 * What to do about a file with changes in it.
 *
 * Three answers, because there are three things a person might mean, and a
 * two-button version makes one of them unreachable: **Save** keeps the work,
 * **Discard** throws it away on purpose, and **Cancel** says the close was
 * the mistake. Escape and clicking away both mean Cancel — the safe one, so
 * a stray keystroke never costs anything.
 *
 * The dialog is deliberately not avoidable. An editor that closed a changed
 * file quietly is one you cannot trust with anything you have not saved.
 */
export function UnsavedDialog({
  name,
  onAnswer,
}: {
  name: string;
  onAnswer: (answer: Answer) => void;
}) {
  const save = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus lands on Save, the answer that loses nothing, so Enter is safe.
    save.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onAnswer("cancel");
      }
    }
    // Capture, so the terminal and the palette do not see it first.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onAnswer]);

  return (
    <div
      className="unsaved"
      // Clicking the backdrop is Cancel, never Discard: the accidental
      // gesture must be the one that loses nothing.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onAnswer("cancel");
      }}
    >
      <div
        className="unsaved__box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-body"
      >
        <h2 className="unsaved__title" id="unsaved-title">
          Save changes to {name.split("/").pop()}?
        </h2>
        <p className="unsaved__body" id="unsaved-body">
          It has changes that are not on disk. Closing without saving throws
          them away.
        </p>

        <div className="unsaved__actions">
          <button
            ref={save}
            type="button"
            className="btn btn--primary"
            onClick={() => onAnswer("save")}
          >
            Save
          </button>
          <button type="button" className="btn btn--danger" onClick={() => onAnswer("discard")}>
            Discard
          </button>
          <button type="button" className="btn" onClick={() => onAnswer("cancel")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
