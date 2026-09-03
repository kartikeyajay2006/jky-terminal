import {
  hasFlag,
  isCommand,
  isPlain,
  lines,
  operands,
  words,
  type Completion,
  type Recognised,
  type Row,
} from "./types";

/**
 * Commands that change the filesystem and then say nothing.
 *
 * `mkdir project` prints nothing at all, which is the shell being correct and
 * unhelpful at once: the most common command anyone runs gives no confirmation
 * that it did what you asked. This is that confirmation, built from the
 * command and the exit status rather than from output there isn't any of.
 *
 * It says nothing on failure. A command that failed already printed why, and
 * a card repeating "did not create it" adds a second thing to read.
 */
const MAKERS: Record<string, { verb: string; noun: string; plural: string }> = {
  mkdir: { verb: "Created", noun: "directory", plural: "directories" },
  touch: { verb: "Created", noun: "file", plural: "files" },
  cp: { verb: "Copied", noun: "", plural: "items" },
  mv: { verb: "Moved", noun: "", plural: "items" },
  rm: { verb: "Removed", noun: "", plural: "items" },
  rmdir: { verb: "Removed", noun: "directory", plural: "directories" },
  ln: { verb: "Linked", noun: "", plural: "links" },
};

export function recogniseFileAction(c: Completion): Recognised | null {
  if (c.code !== 0 || !isPlain(c.command)) return null;

  const parts = words(c.command);
  const program = (parts[0] === "sudo" ? parts[1] : parts[0])?.split("/").pop() ?? "";
  const maker = MAKERS[program];
  if (!maker) return null;

  const targets = operands(c.command);
  if (targets.length === 0) return null;

  // `cp a b` and `mv a b` end at a destination; everything before it is what
  // moved. Saying "Copied a, b" would name the destination as a source.
  const twoEnded = program === "cp" || program === "mv" || program === "ln";
  const destination = twoEnded && targets.length > 1 ? targets[targets.length - 1] : null;
  const subjects = destination ? targets.slice(0, -1) : targets;

  const facts = subjects.map((path) => ({
    label: destination ? "From" : maker.noun || "Path",
    value: path,
  }));
  if (destination) facts.push({ label: "To", value: destination });
  facts.push({ label: "In", value: c.cwd });

  // "3 directory" is the kind of wrong that makes a panel look automatic
  // rather than written, so the plural is spelled out per verb.
  const what = subjects.length === 1 ? subjects[0] : `${subjects.length} ${maker.plural}`;
  const destructive = program === "rm" || program === "rmdir";

  return {
    kind: "file-action",
    glyph: destructive ? "\u2716" : "\u271A",
    // Making something and removing something are not the same news, and the
    // panel should not congratulate you identically for both.
    accent: destructive ? "warn" : "mint",
    title: `${maker.verb} ${what}`,
    subtitle: destination ? `into ${destination}` : c.cwd,
    view: { kind: "facts", facts },
    actions: [
      { key: "l", label: "List it", command: listFor(program, destination ?? subjects[0]) },
    ],
  };
}

/** Where to look to see what just happened. */
function listFor(program: string, path: string): string {
  // After a removal the thing is gone, so the useful place to look is the
  // directory that held it rather than the path that no longer exists.
  if (program === "rm" || program === "rmdir") {
    const parent = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
    return `ls -la ${parent || "."}`;
  }
  return `ls -la ${path}`;
}

/**
 * One row of `ls -l`: permissions, links, owner, group, size, date, name.
 *
 * The date is matched explicitly rather than left to a lazy wildcard, because
 * it contains spaces — `Aug 27 00:48`, and `Sep  2 01:23` with two of them.
 * A wildcard stops at the first space it can and hands back "27 00:48 jky-ai"
 * as the file name, which is wrong in a way that still looks like a table.
 *
 * Two shapes: the default `Mon DD time-or-year`, and the ISO one that
 * `--time-style=long-iso` and several distributions produce.
 */
const WHEN = String.raw`(?:\w{3}\s+\d{1,2}\s+\S+|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})`;
const LONG = new RegExp(
  String.raw`^([-dlbcps][rwxsStT-]{9}[.+@]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(${WHEN})\s+(.+)$`,
);

/**
 * A directory listing.
 *
 * `ls -l` is parsed properly — it has a shape and every field is worth a
 * column. Plain `ls` is columns of names laid out for a terminal of some
 * width, so it is read back as names and nothing more, which is all it says.
 */
export function recogniseLs(c: Completion): Recognised | null {
  if (c.code !== 0 || !isCommand(c.command, "ls") || !isPlain(c.command)) return null;

  const body = lines(c.output);
  if (body.length === 0) return null;

  const long = hasFlag(c.command, "l");
  const where = operands(c.command)[0] ?? c.cwd;

  const rows: Row[] = [];
  if (long) {
    for (const line of body) {
      // `total 24` is a summary, not an entry.
      if (/^total\s+\d+$/.test(line)) continue;
      const found = LONG.exec(line);
      if (!found) continue;

      const [, mode, , owner, , size, when, name] = found;
      rows.push({
        id: `${rows.length}-${name}`,
        tone: mode.startsWith("d") ? "good" : mode.startsWith("l") ? "muted" : undefined,
        cells: {
          name,
          kind: mode.startsWith("d") ? "dir" : mode.startsWith("l") ? "link" : "file",
          size: readableSize(Number(size)),
          mode: mode.slice(0, 10),
          owner,
          when,
        },
      });
    }

    // A listing where nothing matched is not a listing. Better to leave the
    // text alone than to show an empty table beside it.
    if (rows.length === 0) return null;

    const dirs = rows.filter((r) => r.cells.kind === "dir").length;
    return {
      kind: "ls",
      glyph: "\u25A4",
      accent: "accent",
      title: where,
      chips: [
        { text: `${dirs} directories`, tone: "good" },
        { text: `${rows.length - dirs} files`, tone: "muted" },
      ],
      view: {
        kind: "table",
        columns: [
          { key: "kind", label: "", mono: true },
          { key: "name", label: "Name", mono: true },
          { key: "size", label: "Size", align: "right", mono: true },
          { key: "mode", label: "Mode", mono: true, secondary: true },
          { key: "owner", label: "Owner", secondary: true },
          { key: "when", label: "Changed", secondary: true },
        ],
        rows,
      },
    };
  }

  // Plain `ls`: whatever was printed, laid out in columns of some width.
  const names = body
    .flatMap((line) => line.split(/\s{2,}|\t/))
    .map((n) => n.trim())
    .filter((n) => n !== "" && !/^total\s+\d+$/.test(n));
  if (names.length === 0) return null;

  return {
    kind: "ls",
    glyph: "\u25A4",
    accent: "accent",
    title: where,
    subtitle: `${names.length} entries`,
    view: {
      kind: "table",
      columns: [{ key: "name", label: "Name", mono: true }],
      rows: names.map((name, i) => ({ id: `${i}-${name}`, cells: { name } })),
    },
    actions: [{ key: "l", label: "Show details", command: `ls -la ${where}` }],
  };
}

/** A byte count as a person would say it. */
function readableSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
