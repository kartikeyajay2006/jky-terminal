import { useState } from "react";
import { copyText } from "../../terminal/clipboard";

/**
 * The frame every tool wears.
 *
 * Six panels that look like six different programs would make the section
 * feel like a folder of downloads rather than one app. The shape is the same
 * throughout: what you put in on the left or above, what came out below.
 */
export function ToolFrame({
  hint,
  children,
}: {
  /** One line saying what this does, and any promise it makes. */
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="tl">
      <p className="tl__hint">{hint}</p>
      {children}
    </div>
  );
}

/** A labelled block of text someone types or pastes into. */
export function ToolInput({
  label,
  value,
  onChange,
  placeholder,
  rows = 8,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const id = `tl-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="tl__field">
      <label className="tl__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="tl__area"
        value={value}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Copy, and say that it happened.
 *
 * A copy button that looks identical before and after is one people press
 * twice and still do not trust.
 */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="tool tool--small"
      disabled={text === ""}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** A result, or the reason there is not one. */
export function ToolOutput({
  label,
  text,
  error,
}: {
  label: string;
  text: string;
  error?: string | null;
}) {
  return (
    <div className="tl__field">
      <div className="tl__label tl__label--row">
        <span>{label}</span>
        <CopyButton text={text} />
      </div>
      {error ? (
        <p className="tl__error" role="alert">
          {error}
        </p>
      ) : (
        <pre className="tl__out">{text}</pre>
      )}
    </div>
  );
}
