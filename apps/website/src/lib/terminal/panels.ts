import type { Block, Panel } from "../shell/types";
import { h } from "./dom";

/**
 * The panels JKY draws beneath recognised output, rebuilt for the page.
 *
 * Every button in them types a command into the prompt and stops there —
 * the app's second guarantee: an action never runs anything, you press
 * Enter. Every panel can be dismissed, and the raw output above it stays.
 */

export interface PanelActions {
  /** Put a command at the prompt without running it. */
  type(command: string): void;
}

type PanelBlock = Extract<Block, { kind: "panel" }>;

export function renderPanel(block: PanelBlock, actions: PanelActions): HTMLElement {
  const close = h("button", { class: "panel__close", type: "button", "aria-label": "Dismiss this panel" }, "×");
  const panel = h(
    "section",
    { class: "panel", "data-kind": block.panel.kind },
    h(
      "header",
      { class: "panel__head" },
      h("span", { class: "panel__cmd" }, h("span", { class: "panel__chev", "aria-hidden": "true" }, "›"), block.command),
      h("span", { class: "panel__label" }, block.label),
      close,
    ),
    body(block.panel, actions),
  );
  if (block.panel.kind === "docker" || block.panel.kind === "mkdir") {
    panel.append(h("p", { class: "panel__foot" }, "Buttons type into your prompt. Nothing runs until you press Enter."));
  }
  close.addEventListener("click", () => {
    panel.classList.add("is-leaving");
    panel.addEventListener("animationend", () => panel.remove(), { once: true });
    setTimeout(() => panel.remove(), 400);
  });
  return panel;
}

function typer(label: string, command: string, actions: PanelActions, cls = "panel__btn") {
  const b = h("button", { class: cls, type: "button", title: `Types “${command}” — you press Enter` }, label);
  b.addEventListener("click", () => actions.type(command));
  return b;
}

function body(p: Panel, actions: PanelActions): HTMLElement {
  switch (p.kind) {
    case "docker":
      return h(
        "div",
        { class: "dk" },
        ...p.containers.map((c, i) =>
          h(
            "article",
            { class: "dk__card", "data-up": String(c.up), style: `--i:${i}` },
            h(
              "div",
              { class: "dk__top" },
              h("span", { class: "dk__dot", "aria-hidden": "true" }),
              h("strong", { class: "dk__name" }, c.name),
              h("span", { class: "dk__state" }, c.up ? "running" : "exited"),
            ),
            h("div", { class: "dk__img" }, c.image),
            h("div", { class: "dk__meta" }, c.status, c.ports ? ` · ${c.ports.replace(/^0\.0\.0\.0:(\d+).*/, ":$1")}` : ""),
            h(
              "div",
              { class: "dk__actions" },
              typer("logs", `docker logs ${c.name}`, actions),
              c.up ? typer("stop", `docker stop ${c.name}`, actions) : typer("start", `docker start ${c.name}`, actions),
            ),
          ),
        ),
      );

    case "git-status": {
      const col = (title: string, tone: string, rows: { code: string; path: string }[]) =>
        h(
          "div",
          { class: "gs__col" },
          h("div", { class: "gs__title" }, title, h("span", { class: "gs__count" }, String(rows.length))),
          ...rows.map((r, i) => {
            const slash = r.path.lastIndexOf("/");
            return h(
              "div",
              { class: "gs__row", style: `--i:${i}` },
              h("span", { class: `gs__chip gs__chip--${tone}` }, r.code),
              h("span", { class: "gs__file" }, r.path.slice(slash + 1)),
              h("span", { class: "gs__dir" }, slash > 0 ? r.path.slice(0, slash) : ""),
            );
          }),
        );
      return h(
        "div",
        { class: "gs" },
        col("Staged", "mint", p.staged),
        col("Unstaged", "danger", p.unstaged),
        col("Untracked", "dim", p.untracked.map((path) => ({ code: "??", path }))),
      );
    }

    case "git-log":
      return h(
        "ol",
        { class: "gl" },
        ...p.commits.map((c, i) =>
          h(
            "li",
            { class: "gl__item", style: `--i:${i}` },
            h("span", { class: "gl__dot", "aria-hidden": "true" }),
            h("code", { class: "gl__hash" }, c.hash),
            c.head ? h("span", { class: "gl__head" }, "HEAD") : null,
            h("span", { class: "gl__subject" }, c.subject),
            h("span", { class: "gl__when" }, c.when),
          ),
        ),
      );

    case "df":
      return h(
        "div",
        { class: "df" },
        ...[...p.disks]
          .sort((a, b) => b.pct - a.pct)
          .map((d, i) =>
            h(
              "div",
              { class: "df__row", style: `--i:${i}; --pct:${d.pct}%`, "data-level": d.pct >= 90 ? "high" : d.pct >= 75 ? "mid" : "low" },
              h("span", { class: "df__mount" }, d.mount),
              h("span", { class: "df__bar" }, h("span", { class: "df__fill" })),
              h("span", { class: "df__num" }, `${d.used} / ${d.size} · ${d.pct}%`),
            ),
          ),
      );

    case "ls":
      return h(
        "div",
        { class: "ls" },
        ...p.entries.map((e, i) =>
          h(
            "div",
            { class: "ls__row", style: `--i:${i}`, "data-dir": String(e.dir) },
            h("span", { class: "ls__icon", "aria-hidden": "true" }, e.dir ? "▸" : "·"),
            h("span", { class: "ls__name" }, e.dir ? `${e.name}/` : e.name),
            h("span", { class: "ls__size" }, e.dir ? "dir" : e.size),
            h("span", { class: "ls__date" }, e.date),
          ),
        ),
      );

    case "json":
      return h("div", { class: "jt" }, tree(p.value, null, 0));

    case "mkdir":
      return h(
        "div",
        { class: "mk" },
        h("span", { class: "mk__ok", "aria-hidden": "true" }, "✓"),
        h("span", null, "Created ", h("code", null, `${p.dir}/`), " — mkdir printed nothing, so JKY says so."),
        typer(`cd ${p.dir}`, `cd ${p.dir}`, actions),
      );
  }
}

/** A JSON value as a tree whose objects and arrays fold. */
function tree(value: unknown, key: string | null, depth: number): HTMLElement {
  const label = key === null ? null : h("span", { class: "jt__key" }, `"${key}"`, h("span", { class: "jt__punct" }, ": "));
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    const open = Array.isArray(value) ? "[" : "{";
    const shut = Array.isArray(value) ? "]" : "}";
    const toggle = h("button", { class: "jt__toggle", type: "button", "aria-expanded": "true" }, "▾");
    const summary = h("span", { class: "jt__summary" }, ` ${entries.length} ${Array.isArray(value) ? "items" : "keys"} `);
    const children = h("div", { class: "jt__children" }, ...entries.map(([k, v]) => tree(v, Array.isArray(value) ? null : k, depth + 1)));
    const node = h(
      "div",
      { class: "jt__node", "data-open": "true" },
      h("div", { class: "jt__line" }, toggle, label, h("span", { class: "jt__punct" }, open), summary, h("span", { class: "jt__punct jt__close-inline" }, shut)),
      children,
      h("div", { class: "jt__line jt__end" }, h("span", { class: "jt__punct" }, shut)),
    );
    toggle.addEventListener("click", () => {
      const isOpen = node.dataset.open === "true";
      node.dataset.open = String(!isOpen);
      toggle.textContent = isOpen ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(!isOpen));
    });
    return node;
  }
  const tone = typeof value === "string" ? "str" : typeof value === "number" ? "num" : "lit";
  return h(
    "div",
    { class: "jt__line jt__leaf" },
    label,
    h("span", { class: `jt__${tone}` }, typeof value === "string" ? `"${value}"` : String(value)),
  );
}
