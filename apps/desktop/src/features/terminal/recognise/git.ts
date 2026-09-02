import {
  isCommand,
  isPlain,
  lines,
  type Completion,
  type Entry,
  type Recognised,
  type Row,
} from "./types";

/** What each short-status letter means, in words rather than in punctuation. */
const STATUS: Record<string, { label: string; tone: Row["tone"] }> = {
  M: { label: "modified", tone: "warn" },
  A: { label: "added", tone: "good" },
  D: { label: "deleted", tone: "bad" },
  R: { label: "renamed", tone: "warn" },
  C: { label: "copied", tone: "good" },
  U: { label: "conflicted", tone: "bad" },
  "?": { label: "untracked", tone: "muted" },
  "!": { label: "ignored", tone: "muted" },
};

/**
 * `git status --short`, which is the one worth parsing.
 *
 * The default output is prose — "Changes not staged for commit:", a hint
 * about `git restore`, a blank line — and it is translated, so a parser for
 * it works in English and silently produces nothing anywhere else. The short
 * form is two columns of letters and a path: stable across versions, the same
 * in every locale, and it is what the porcelain format exists for.
 *
 * The two columns are not the same thing and the panel keeps them apart. The
 * left is the index and the right is the working tree, which is exactly the
 * distinction people come to `git status` to see: `MM` means you staged a
 * change and then made another one.
 */
export function recogniseGitStatus(c: Completion): Recognised | null {
  if (c.code !== 0 || !isPlain(c.command)) return null;
  if (!isCommand(c.command, "git", "status")) return null;
  if (!/(^|\s)(-s|--short|--porcelain)(\s|$)/.test(c.command)) return null;

  const rows: Row[] = [];
  for (const line of lines(c.output)) {
    // Exactly two status characters, a space, then the path.
    if (line.length < 4) continue;
    const staged = line[0];
    const tree = line[1];
    const path = line.slice(3).trim();
    if (path === "") continue;
    if (!(staged in STATUS) && staged !== " ") continue;
    if (!(tree in STATUS) && tree !== " ") continue;

    const worst = STATUS[tree] ?? STATUS[staged];
    rows.push({
      id: `${rows.length}-${path}`,
      tone: worst?.tone,
      cells: {
        path,
        staged: staged === " " ? "" : (STATUS[staged]?.label ?? staged),
        tree: tree === " " ? "" : (STATUS[tree]?.label ?? tree),
      },
    });
  }

  if (rows.length === 0) return null;

  const stagedCount = rows.filter((r) => r.cells.staged !== "").length;
  return {
    kind: "git-status",
    title: "Working tree",
    subtitle: `${rows.length} changed · ${stagedCount} staged`,
    view: {
      kind: "table",
      columns: [
        { key: "path", label: "Path", mono: true },
        { key: "staged", label: "Staged" },
        { key: "tree", label: "Not staged" },
      ],
      rows,
    },
    actions: [
      { key: "d", label: "Diff", command: "git diff" },
      { key: "a", label: "Stage all", command: "git add -A" },
      { key: "l", label: "History", command: "git log --oneline -20" },
    ],
  };
}

const COMMIT = /^commit ([0-9a-f]{7,40})/;
const ONELINE = /^([0-9a-f]{7,40})\s+(.+)$/;

/**
 * `git log`, as a timeline.
 *
 * Two formats, because people type both. The default is a block per commit —
 * `commit`, `Author:`, `Date:`, a blank line, then the message indented by
 * four — and `--oneline` is a hash and a subject. Anything else (`--graph`,
 * a custom `--pretty`) is left alone: a format nobody specified is a format
 * this cannot claim to understand.
 */
export function recogniseGitLog(c: Completion): Recognised | null {
  if (c.code !== 0 || !isPlain(c.command)) return null;
  if (!isCommand(c.command, "git", "log")) return null;
  // A graph is drawn with characters that carry the meaning; flattening it
  // into a list would throw away the only thing the flag was asked for.
  if (/--graph|--pretty|--format/.test(c.command)) return null;

  const body = lines(c.output);
  if (body.length === 0) return null;

  const entries: Entry[] =
    body[0].startsWith("commit ") ? fullLog(body) : onelineLog(body);
  if (entries.length === 0) return null;

  return {
    kind: "git-log",
    title: "History",
    subtitle: `${entries.length} commits`,
    view: { kind: "timeline", entries },
    actions: [
      { key: "s", label: "Status", command: "git status -s" },
      { key: "d", label: "Diff last", command: "git show --stat HEAD" },
    ],
  };
}

function fullLog(body: string[]): Entry[] {
  const entries: Entry[] = [];
  let current: { sha: string; meta: string[]; message: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const [subject, ...rest] = current.message;
    entries.push({
      id: current.sha,
      title: subject ?? "(no message)",
      meta: [current.sha.slice(0, 7), ...current.meta],
      body: rest.join("\n").trim() || undefined,
    });
    current = null;
  };

  for (const line of body) {
    const found = COMMIT.exec(line);
    if (found) {
      flush();
      current = { sha: found[1], meta: [], message: [] };
      continue;
    }
    if (!current) continue;

    // `Author: Name <email>` — the name is what a timeline shows.
    const author = /^Author:\s+(.+?)\s*<.*>$/.exec(line);
    if (author) {
      current.meta.push(author[1]);
      continue;
    }
    const date = /^Date:\s+(.+)$/.exec(line);
    if (date) {
      current.meta.push(date[1].trim());
      continue;
    }
    // Merge, and any other header, is skipped rather than treated as message.
    if (/^[A-Z][A-Za-z-]*:\s/.test(line)) continue;

    const text = line.replace(/^ {4}/, "");
    if (text.trim() !== "" || current.message.length > 0) current.message.push(text);
  }
  flush();

  return entries;
}

function onelineLog(body: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const line of body) {
    const found = ONELINE.exec(line.trim());
    if (!found) continue;
    entries.push({ id: found[1], title: found[2], meta: [found[1]] });
  }
  return entries;
}
