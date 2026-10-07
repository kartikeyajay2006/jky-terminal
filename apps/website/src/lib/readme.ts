/**
 * The comparison on the website is the README's, read at build time.
 *
 * The README's table was checked against each project's own docs and is
 * kept honest there — sources in docs/comparison.md, blanks where nothing
 * was verified. Typing a second copy into the site would be a second thing
 * to keep honest; parsing the first means they cannot disagree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./facts";

export type Mark = "yes" | "partly" | "no" | "unknown" | "text";

export interface Cell {
  mark: Mark;
  note: string;
}

export interface Comparison {
  columns: string[];
  rows: { label: string; cells: Cell[] }[];
  different: string[];
  behind: string[];
}

function cell(raw: string): Cell {
  const t = raw.trim().replace(/\*\*/g, "");
  if (t.startsWith("🟢")) return { mark: "yes", note: t.slice(2).trim() };
  if (t.startsWith("🟡")) return { mark: "partly", note: t.slice(2).trim() };
  if (t.startsWith("⚪")) return { mark: "no", note: t.slice(1).trim() };
  if (t === "—" || t === "-") return { mark: "unknown", note: "" };
  return { mark: "text", note: t };
}

const split = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** The bullets under a README heading, until the list ends. */
function bullets(md: string, heading: RegExp): string[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  let current = "";
  for (const line of lines.slice(start + 1)) {
    if (/^\s*-\s+/.test(line)) {
      if (current) out.push(current);
      current = line.replace(/^\s*-\s+/, "");
    } else if (current && /^\s{2,}\S/.test(line)) {
      current += ` ${line.trim()}`;
    } else if (current) {
      break;
    }
  }
  if (current) out.push(current);
  return out;
}

export function readComparison(root = repoRoot()): Comparison {
  const md = readFileSync(join(root, "README.md"), "utf8");
  const lines = md.split("\n");
  const head = lines.findIndex((l) => /^\|\s*\|\s*\*\*JKY\*\*/.test(l));
  if (head < 0) throw new Error("README: the comparison table was not found");
  const columns = split(lines[head])
    .slice(1)
    .map((c) => c.replace(/\*\*/g, ""));
  const rows: Comparison["rows"] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [label, ...cells] = split(line);
    rows.push({ label, cells: cells.map(cell) });
  }
  return {
    columns,
    rows,
    different: bullets(md, /^####.*Where JKY is different/),
    behind: bullets(md, /^####.*Where JKY is behind today/),
  };
}

/** The little markdown the README's bullets use: bold, code and links. */
export function inline(md: string): string {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
      const url = /^https?:/.test(href) ? href : `https://github.com/kartikeyajay2006/jky-terminal/blob/main/${href.replace(/^\.\//, "")}`;
      return `<a href="${url}">${text}</a>`;
    });
}
