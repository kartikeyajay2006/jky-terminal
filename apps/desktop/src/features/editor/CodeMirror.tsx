import { useEffect, useRef } from "react";
import { EditorState, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { editorTheme } from "./theme";
import { loadMode, modeFor } from "./language";

interface CodeMirrorProps {
  /** Which file this is. Changing it replaces the document wholesale. */
  path: string;
  /** The text as it was read. Only consulted when `path` changes. */
  initial: string;
  onChange: (text: string) => void;
  onSave: () => void;
}

/**
 * One editor.
 *
 * CodeMirror owns its own DOM, so React's job here is to create it once and
 * stay out of the way — the document is replaced through a transaction when
 * the file changes rather than by re-rendering, because re-rendering would
 * throw away the undo history and the cursor with it.
 */
export function CodeMirror({ path, initial, onChange, onSave }: CodeMirrorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Kept in refs so changing a handler does not tear down the editor. A
  // dependency on `onChange` would rebuild it on every keystroke of the
  // parent's state.
  const changed = useRef(onChange);
  const saved = useRef(onSave);
  changed.current = onChange;
  saved.current = onSave;

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        // Before the defaults, so it wins: Ctrl/Cmd+S is the one key an
        // editor must never let through to anything else.
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            saved.current();
            return true;
          },
        },
        // Tab indents rather than leaving the editor. Escape then Tab still
        // moves focus, which is what keeps this reachable without a mouse.
        indentWithTab,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) changed.current(update.state.doc.toString());
      }),
      EditorView.lineWrapping,
      ...editorTheme(),
    ];

    const editor = new EditorView({
      state: EditorState.create({ doc: initial, extensions }),
      parent: host.current,
    });
    view.current = editor;

    // The language arrives after the file does. Appended through a
    // reconfiguration rather than awaited before the editor exists, so a
    // large file is on screen and scrollable while its mode is still loading.
    let live = true;
    void loadMode(modeFor(path)).then((mode) => {
      if (!live || !mode) return;
      editor.dispatch({ effects: StateEffect.appendConfig.of(mode) });
    });

    return () => {
      live = false;
      editor.destroy();
      view.current = null;
    };
    // Only on the file. `initial` is the opening document and later text
    // comes from the editor itself, so depending on it would rebuild the
    // editor on every keystroke — throwing away the undo history and the
    // cursor with it. The handlers are held in refs above for the same
    // reason.
  }, [path]);

  return <div className="editor__surface" ref={host} data-path={path} />;
}
