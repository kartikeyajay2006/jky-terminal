import type { Extension } from "@codemirror/state";

/**
 * Which language a file is, and loading it only when one is opened.
 *
 * Every mode is a dynamic import, so each becomes its own chunk and none of
 * them is in the bundle somebody who never opens the editor downloads. That
 * is the whole reason this app can have an editor at all: Monaco is several
 * megabytes that ship whether or not you use it, and CodeMirror split this
 * way is a few kilobytes plus whatever you actually open.
 */
const MODES: Record<string, () => Promise<Extension>> = {
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  jsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  tsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  python: async () => (await import("@codemirror/lang-python")).python(),
};

/**
 * The mode for a filename, or null for one nothing is known about.
 *
 * Null is an ordinary answer, not a failure: a file with no mode opens as
 * plain text, which is what it is. Guessing at a language from the contents
 * would mean colouring a file wrong with confidence.
 */
export function modeFor(filename: string): string | null {
  const name = filename.toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1);

  // Files whose name is the whole answer, before any extension is consulted.
  const byName: Record<string, string> = {
    dockerfile: "python",
    makefile: "python",
    ".gitignore": "python",
  };
  const base = name.slice(name.lastIndexOf("/") + 1);
  if (byName[base]) return byName[base];

  const byExtension: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "tsx",
    rs: "rust",
    json: "json",
    jsonc: "json",
    md: "markdown",
    markdown: "markdown",
    css: "css",
    scss: "css",
    html: "html",
    htm: "html",
    svg: "html",
    xml: "html",
    py: "python",
    // Not Python, but its comment and string rules are close enough to be
    // useful and honest about being approximate — and a TOML mode is another
    // dependency for three files.
    toml: "python",
    yml: "python",
    yaml: "python",
  };

  return byExtension[extension] ?? null;
}

/** Load one mode. Resolves to null when there is nothing to load. */
export async function loadMode(mode: string | null): Promise<Extension | null> {
  if (!mode) return null;
  const load = MODES[mode];
  if (!load) return null;
  try {
    return await load();
  } catch {
    // A chunk that will not load costs the colours and nothing else. The
    // file still opens, and plain text is the honest fallback.
    return null;
  }
}
