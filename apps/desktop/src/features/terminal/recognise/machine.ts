import {
  headerOffsets,
  isCommand,
  isPlain,
  lines,
  sliceAt,
  type Completion,
  type Meter,
  type Recognised,
  type Row,
} from "./types";

/**
 * `df`, as bars rather than as a column of percentages.
 *
 * A percentage in a table is a number you compare by reading; a bar is one
 * you compare by looking. Four disks at 12%, 40%, 61% and 91% take a moment
 * to rank as text and none at all as bars — which is the entire reason
 * anybody runs `df`.
 */
export function recogniseDf(c: Completion): Recognised | null {
  if (c.code !== 0 || !isCommand(c.command, "df") || !isPlain(c.command)) return null;

  const body = lines(c.output);
  if (body.length < 2) return null;
  if (!/^Filesystem\s/i.test(body[0])) return null;

  const meters: Meter[] = [];
  for (const line of body.slice(1)) {
    // Filesystem, size, used, available, percentage, mount — and the mount
    // may contain spaces, so it takes the rest of the line.
    const found = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)%\s+(.+)$/.exec(line);
    if (!found) continue;

    const [, device, total, used, , percent, mount] = found;
    // Sized in whatever unit `df` was asked for, so the bar is driven by the
    // percentage the tool already computed rather than by re-parsing "175G".
    meters.push({
      label: mount.trim(),
      used: Number(percent),
      total: 100,
      usedText: used,
      totalText: total,
      note: device,
    });
  }

  if (meters.length === 0) return null;

  // Fullest first: the one that is about to be a problem is the one you came
  // to look for, and it is rarely the first line of the output.
  meters.sort((a, b) => b.used - a.used);

  const tight = meters.filter((m) => m.used >= 85).length;
  return {
    kind: "df",
    glyph: "▥",
    accent: "accent-dim",
    title: "Disks",
    subtitle: `${meters.length} mounted`,
    // The one that is about to be a problem, said before the bars are read.
    chips: tight > 0 ? [{ text: `${tight} nearly full`, tone: "bad" }] : undefined,
    view: { kind: "meters", meters },
  };
}

/**
 * `ps`, as a table you can read.
 *
 * The command is the last column and contains spaces, so it takes the rest of
 * the line — splitting on whitespace would cut every process at its first
 * argument, which is where the useful part starts.
 */
export function recognisePs(c: Completion): Recognised | null {
  if (c.code !== 0 || !isCommand(c.command, "ps") || !isPlain(c.command)) return null;

  const body = lines(c.output);
  if (body.length < 2) return null;

  const header = body[0];
  if (!/\bPID\b/.test(header) || !/\bCOMMAND\b|\bCMD\b/.test(header)) return null;

  // `ps aux` and `ps -ef` put their columns in different orders, so the
  // header is read rather than assumed.
  const names = header.trim().split(/\s+/);
  const at = (want: string[]) => names.findIndex((n) => want.includes(n));
  const pidAt = at(["PID"]);
  const cpuAt = at(["%CPU", "C"]);
  const memAt = at(["%MEM"]);
  const userAt = at(["USER", "UID"]);
  const commandAt = at(["COMMAND", "CMD"]);
  if (pidAt === -1 || commandAt === -1) return null;

  const rows: Row[] = [];
  for (const line of body.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length <= commandAt) continue;
    const pid = parts[pidAt];
    if (!/^\d+$/.test(pid)) continue;

    const cpu = cpuAt === -1 ? "" : parts[cpuAt];
    rows.push({
      id: pid,
      tone: Number(cpu) >= 50 ? "warn" : undefined,
      cells: {
        pid,
        user: userAt === -1 ? "" : parts[userAt],
        cpu: cpu === "" ? "" : `${cpu}%`,
        mem: memAt === -1 ? "" : `${parts[memAt]}%`,
        // The rest of the line, because a command line is mostly spaces.
        command: parts.slice(commandAt).join(" "),
      },
    });
  }

  if (rows.length === 0) return null;

  const busy = rows.filter((r) => r.tone === "warn").length;
  return {
    kind: "ps",
    glyph: "☰",
    accent: "magenta",
    title: "Processes",
    subtitle: `${rows.length} listed`,
    chips: busy > 0 ? [{ text: `${busy} working hard`, tone: "warn" }] : undefined,
    view: {
      kind: "table",
      columns: [
        { key: "pid", label: "Id", align: "right", mono: true },
        { key: "user", label: "User", secondary: true },
        { key: "cpu", label: "CPU", align: "right", mono: true },
        { key: "mem", label: "Memory", align: "right", mono: true, secondary: true },
        { key: "command", label: "Command", mono: true },
      ],
      rows,
    },
  };
}

/**
 * `docker ps`, as the table it already is.
 *
 * Docker column-aligns its output with two or more spaces between fields, and
 * every field can contain one — an image tag, a status phrase, a port map. So
 * the header is measured and the rows are split the same way, rather than on
 * single spaces.
 */
export function recogniseDockerPs(c: Completion): Recognised | null {
  if (c.code !== 0 || !isPlain(c.command)) return null;
  if (!isCommand(c.command, "docker", "ps") && !isCommand(c.command, "podman", "ps")) {
    return null;
  }

  const body = lines(c.output);
  if (body.length < 2) return null;

  // Read by column position, not by splitting on spaces. A container that
  // publishes no ports leaves PORTS empty, and a split on whitespace gives
  // that row one field fewer — so everything after it shifts left and lands
  // under the wrong heading, while still looking like a table.
  const header = body[0];
  const wanted = ["CONTAINER ID", "IMAGE", "STATUS", "PORTS", "NAMES"];
  if (!wanted.every((label) => header.includes(label))) return null;

  // Measured in the order docker prints them, which is not the order above.
  const printed = ["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]
    .filter((label) => header.includes(label));
  const offsets = headerOffsets(header, printed);
  if (!offsets) return null;

  const field = (parts: string[], label: string) => {
    const at = printed.indexOf(label);
    return at === -1 ? "" : (parts[at] ?? "");
  };

  const rows: Row[] = [];
  for (const line of body.slice(1)) {
    if (line.trim() === "") continue;
    const parts = sliceAt(line, offsets);
    const id = field(parts, "CONTAINER ID");
    if (id === "") continue;

    const status = field(parts, "STATUS");
    rows.push({
      id,
      // "Up 2 hours" is running; "Exited (0)" is not. The word is the state.
      tone: /^up\b/i.test(status) ? "good" : /exited|dead/i.test(status) ? "bad" : "muted",
      cells: {
        name: field(parts, "NAMES") || id,
        image: field(parts, "IMAGE"),
        status,
        ports: field(parts, "PORTS"),
      },
    });
  }

  if (rows.length === 0) return null;

  const running = rows.filter((r) => r.tone === "good").length;
  const stopped = rows.length - running;
  return {
    kind: "docker-ps",
    glyph: "▢",
    accent: "lime",
    title: "Containers",
    chips: [
      { text: `${running} running`, tone: "good" },
      ...(stopped > 0 ? [{ text: `${stopped} stopped`, tone: "bad" as const }] : []),
    ],
    view: {
      kind: "table",
      columns: [
        { key: "name", label: "Container", mono: true },
        { key: "status", label: "Status", as: "status" },
        { key: "ports", label: "Ports", mono: true },
        { key: "image", label: "Image", mono: true, secondary: true },
      ],
      rows,
    },
    actions: [
      { key: "a", label: "Include stopped", command: "docker ps -a" },
      { key: "s", label: "Stats", command: "docker stats --no-stream" },
    ],
  };
}

/**
 * Output that is JSON.
 *
 * Not tied to a command, because the commands that print JSON are endless —
 * `curl`, `jq`, `aws`, `kubectl -o json`, half of `npm`. What matters is that
 * the output parses, and that it is worth laying out: a bare number or a
 * short string is valid JSON and is already perfectly readable as text.
 */
export function recogniseJson(c: Completion): Recognised | null {
  const text = c.output.trim();
  if (text.length < 40) return null;
  if (!/^[[{]/.test(text)) return null;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const laid = JSON.stringify(value, null, 2);
  // Already laid out, so there is nothing to add by laying it out again.
  if (laid === text) return null;

  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  return {
    kind: "json",
    glyph: "{}",
    // The generic one, and it wears the neutral: it recognises a shape rather
    // than a command, so it has no subject to take a colour from.
    accent: "text-muted",
    title: "JSON",
    subtitle: Array.isArray(value) ? `${count} items` : `${count} keys`,
    view: { kind: "json", text: laid },
  };
}
