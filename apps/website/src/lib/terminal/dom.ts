/** A small element builder, so the terminal's DOM code reads like markup. */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean | undefined> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "text") el.textContent = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
