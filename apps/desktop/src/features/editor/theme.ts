import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** Read one theme token, so the editor follows whichever palette is active. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The editor, in whatever theme is on.
 *
 * Built at call time from the CSS custom properties rather than written as
 * colours. A literal hex here would be a lint error and would also be wrong
 * in six of the seven themes — and invisible in High Contrast, which is the
 * one where it would matter most.
 *
 * The fallbacks exist for jsdom, where `getComputedStyle` returns nothing for
 * a custom property. They are never used in the app.
 */
export function editorTheme(): Extension[] {
  const text = token("--text", "#e8e8f2");
  const dim = token("--text-dim", "#6e6e85");
  const muted = token("--text-muted", "#9a9ab2");
  const accent = token("--accent", "#00e5ff");
  const surface = token("--surface", "#0e0e16");
  const line = token("--line", "#1e1e2c");
  const magenta = token("--magenta", "#ff3cf0");
  const mint = token("--mint", "#3ddc97");
  const warn = token("--warn", "#ffb340");
  const violet = token("--violet", "#7c3aed");

  const view = EditorView.theme(
    {
      "&": { color: text, backgroundColor: surface, height: "100%" },
      ".cm-content": { fontFamily: token("--font-mono", "monospace"), caretColor: accent },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: token("--accent-glow", "rgba(0, 229, 255, 0.14)"),
      },
      ".cm-gutters": { backgroundColor: surface, color: dim, border: "none" },
      ".cm-activeLine": { backgroundColor: token("--surface-raised", "#14141f") },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: muted },
      ".cm-selectionMatch": { backgroundColor: token("--accent-glow", "rgba(0,229,255,.14)") },
      ".cm-searchMatch": { outline: `1px solid ${accent}` },
      ".cm-panels": { backgroundColor: surface, color: text, borderTop: `1px solid ${line}` },
      "&.cm-focused": { outline: "none" },
    },
    { dark: true },
  );

  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: magenta },
    { tag: [tags.controlKeyword, tags.moduleKeyword], color: magenta },
    { tag: [tags.name, tags.deleted, tags.character], color: text },
    { tag: [tags.function(tags.variableName), tags.labelName], color: accent },
    { tag: [tags.propertyName], color: accent },
    { tag: [tags.string, tags.special(tags.string)], color: mint },
    { tag: [tags.number, tags.bool, tags.null], color: warn },
    { tag: [tags.typeName, tags.className, tags.namespace], color: violet },
    { tag: [tags.comment, tags.blockComment, tags.lineComment], color: dim, fontStyle: "italic" },
    { tag: [tags.operator, tags.punctuation, tags.separator], color: muted },
    { tag: tags.heading, color: accent, fontWeight: "bold" },
    { tag: tags.link, color: accent, textDecoration: "underline" },
    { tag: tags.invalid, color: token("--danger", "#ff4d6a") },
  ]);

  return [view, syntaxHighlighting(highlight)];
}
