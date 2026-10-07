import type { Block, Line, Result, ShellContext, Span } from "./types";

/**
 * The commands the website's terminal knows.
 *
 * Each prints what the real tool prints, in the shape the app's recognisers
 * read — then, where JKY would, adds the panel the app draws beneath it. The
 * data is a made-up project (`acme/api`), but every behaviour shown is the
 * app's: panels sit under raw output and never replace it, actions only type,
 * a pipe makes the recogniser step aside, and the assistant asks first.
 */

const t = (text: string, tone?: Span["tone"]): Span => ({ text, tone });
const line = (...spans: (Span | string)[]): Line => spans.map((s) => (typeof s === "string" ? t(s) : s));
const lines = (...ls: Line[]): Block => ({ kind: "lines", lines: ls });

const CONTAINERS = [
  {
    id: "4f2a9c1e8b3d",
    image: "postgres:16",
    cmd: '"docker-entrypoint.s…"',
    status: "Up 2 hours",
    ports: "0.0.0.0:5432->5432/tcp",
    name: "db",
  },
  {
    id: "9b7e2d4a6c1f",
    image: "redis:7-alpine",
    cmd: '"redis-server"',
    status: "Up 2 hours",
    ports: "0.0.0.0:6379->6379/tcp",
    name: "cache",
  },
  {
    id: "e1c3b5d7f9a2",
    image: "acme/api:dev",
    cmd: '"node dist/server.js"',
    status: "Up 12 minutes",
    ports: "0.0.0.0:8080->8080/tcp",
    name: "api",
  },
  {
    id: "7d5f3b1a9e8c",
    image: "acme/worker:dev",
    cmd: '"node dist/worker.js"',
    status: "Exited (1) 3 minutes ago",
    ports: "",
    name: "worker",
  },
];

function pad(s: string, n: number) {
  return s.length >= n ? `${s} ` : s + " ".repeat(n - s.length);
}

function dockerTable(filter?: string): Line[] {
  const head = line(
    t(
      `${pad("CONTAINER ID", 15)}${pad("IMAGE", 17)}${pad("COMMAND", 24)}${pad("STATUS", 27)}${pad("PORTS", 25)}NAMES`,
      "dim",
    ),
  );
  const rows = CONTAINERS.filter((c) => !filter || Object.values(c).some((v) => v.includes(filter))).map((c) =>
    line(
      `${pad(c.id, 15)}${pad(c.image, 17)}${pad(c.cmd, 24)}`,
      t(pad(c.status, 27), c.status.startsWith("Up") ? "mint" : "danger"),
      `${pad(c.ports, 25)}${c.name}`,
    ),
  );
  return filter ? rows : [head, ...rows];
}

const GIT_STATUS = {
  staged: [
    { code: "M", path: "src/server.ts" },
    { code: "A", path: "src/routes/health.ts" },
  ],
  unstaged: [{ code: "M", path: "README.md" }],
  untracked: ["notes/todo.md"],
};

const COMMITS = [
  { hash: "3f9c2ab", subject: "feat(api): a health endpoint that checks the database", when: "2 hours ago", head: true },
  { hash: "b81e4d0", subject: "fix(worker): retry a job once before failing it", when: "5 hours ago", head: false },
  { hash: "6a2c9f7", subject: "chore(deps): bump postgres driver", when: "yesterday", head: false },
  { hash: "d40b3e1", subject: "feat(api): paginate /orders", when: "2 days ago", head: false },
];

const DISKS = [
  { fs: "/dev/nvme0n1p2", size: "468G", used: "426G", avail: "42G", pct: 91, mount: "/" },
  { fs: "/dev/sda1", size: "1.8T", used: "1.1T", avail: "682G", pct: 62, mount: "/data" },
  { fs: "/dev/nvme0n1p1", size: "511M", used: "61M", avail: "451M", pct: 12, mount: "/boot/efi" },
];

const FILES = [
  { name: "dist", dir: true, size: "4.0K", date: "Oct  8 09:12" },
  { name: "node_modules", dir: true, size: "4.0K", date: "Oct  7 18:40" },
  { name: "src", dir: true, size: "4.0K", date: "Oct  8 09:10" },
  { name: "package.json", dir: false, size: "1.2K", date: "Oct  7 18:39" },
  { name: "README.md", dir: false, size: "3.4K", date: "Oct  8 08:55" },
  { name: "tsconfig.json", dir: false, size: "512", date: "Oct  2 11:03" },
];

const PACKAGE = {
  name: "acme-api",
  version: "2.4.0",
  private: true,
  scripts: { dev: "tsx watch src/server.ts", build: "tsc -p .", test: "vitest run" },
  dependencies: { fastify: "^5.2.0", pg: "^8.13.1", ioredis: "^5.4.2" },
};

export const THEME_IDS = ["cyberpunk", "dracula", "nord", "solarized", "light", "gold", "contrast"];

/** Commands Tab can complete, and their arguments. */
export const COMPLETIONS: Record<string, string[]> = {
  "": [
    "help",
    "docker",
    "git",
    "df",
    "ls",
    "cat",
    "mkdir",
    "jky",
    "ask",
    "npm",
    "clear",
    "pwd",
    "whoami",
    "echo",
    "date",
    "history",
    "exit",
  ],
  docker: ["ps"],
  git: ["status", "log"],
  "git status": ["-s"],
  df: ["-h"],
  ls: ["-l"],
  cat: ["package.json", "README.md", "tsconfig.json"],
  jky: ["theme", "version", "help"],
  "jky theme": THEME_IDS,
  npm: ["run"],
  "npm run": ["build", "test", "dev"],
};

/** Splits a command line into words, honouring simple quotes. */
export function words(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of input.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function help(): Result {
  const row = (cmd: string, what: string) => line(t(`  ${pad(cmd, 20)}`, "accent"), t(what, "muted"));
  return {
    blocks: [
      lines(
        line(t("What this terminal knows — and what JKY does with it:", "text")),
        line(""),
        row("docker ps", "containers, as cards beneath the output"),
        row("git status -s", "staged and unstaged, kept apart"),
        row("git log", "the history as a timeline"),
        row("df -h", "disks, fullest first"),
        row("ls -l", "a listing with kinds and sizes"),
        row("cat package.json", "JSON as a tree you can fold"),
        row("mkdir demo", "the confirmation mkdir never prints"),
        row("docker ps | grep api", "a pipe: the panel steps aside"),
        row("jky theme <name>", "re-theme everything, this page included"),
        row("ask <anything>", "the assistant, which has to ask first"),
        row("npm run build", "a build, streaming"),
        row("clear", "start over"),
        line(""),
        line(t("Tab completes, ↑ ↓ walk your history. ", "dim"), t("A simulation in your browser;", "dim")),
        line(t("JKY itself runs your real shell.", "dim")),
      ),
    ],
  };
}

function jky(argv: string[], ctx: ShellContext): Result {
  const [sub, arg] = argv;
  if (!sub) return { blocks: [{ kind: "banner", version: ctx.version }] };
  if (sub === "version" || sub === "--version") {
    return { blocks: [lines(line(`JKY Terminal ${ctx.version}`))] };
  }
  if (sub === "theme") {
    if (!arg) {
      const current = ctx.currentTheme();
      return {
        blocks: [
          lines(
            ...ctx.themes.map((th) =>
              line(
                t(th.id === current ? "● " : "  ", "accent"),
                t(pad(th.id, 12), th.id === current ? "accent" : "text"),
                t(th.label, "dim"),
              ),
            ),
            line(""),
            line(t("jky theme <name> switches — the app, and here, this whole page.", "dim")),
          ),
        ],
      };
    }
    const id = arg.toLowerCase();
    const theme = ctx.themes.find((th) => th.id === id || th.label.toLowerCase() === id);
    if (!theme) {
      return {
        blocks: [
          lines(
            line(t(`jky: no theme called "${arg}"`, "danger")),
            line(t(`themes: ${ctx.themes.map((th) => th.id).join(" ")}`, "dim")),
          ),
        ],
      };
    }
    return {
      blocks: [lines(line(t("theme → ", "dim"), t(theme.label, "accent")))],
      effects: { theme: theme.id },
    };
  }
  if (sub === "help") {
    return {
      blocks: [
        lines(
          line(t("jky", "accent"), "                  open JKY, or bring it forward"),
          line(t("jky theme <name>", "accent"), "     switch the theme from any shell"),
          line(t("jky version", "accent"), "          the installed version"),
          line(t("jky shortcut <keys>", "accent"), "  change the summon shortcut"),
        ),
      ],
    };
  }
  return { blocks: [lines(line(t(`jky: unknown command "${sub}" — try jky help`, "danger")))] };
}

function ask(argv: string[]): Result {
  const question = argv.join(" ").trim();
  const destructive = /clean|delete|remove|wipe|reset|rm\b/i.test(question);
  if (destructive) {
    return {
      blocks: [
        {
          kind: "approval",
          proposal: {
            said: "The build output is in dist/. Removing it gives you a clean build:",
            command: "rm -rf dist",
            reads: "nothing",
            writes: "deletes dist/ — 214 files, 3.1 MB",
            network: "none",
            confirm: "dist",
            result: [line(t("removed dist/", "mint"), t("  ·  214 files", "dim"))],
          },
        },
      ],
    };
  }
  return {
    blocks: [
      {
        kind: "approval",
        proposal: {
          said: question
            ? "I read the project freely. Running anything is yours to approve — this checks what holds port 8080:"
            : "Ask me anything about this project. To start, here is what is listening on 8080:",
          command: "lsof -i :8080",
          reads: "the process table",
          writes: "nothing",
          network: "none",
          result: [
            line(t("COMMAND   PID USER   FD   TYPE  NODE NAME", "dim")),
            line("node    48213 you    23u  IPv4  TCP  *:8080 (LISTEN)"),
            line(t("→ it is the api container's dev server.", "muted")),
          ],
        },
      },
    ],
  };
}

function git(argv: string[]): Result {
  const [sub, ...rest] = argv;
  if (sub === "status" && rest.includes("-s")) {
    const shown = [
      ...GIT_STATUS.staged.map((f) => line(t(`${f.code} `, "mint"), ` ${f.path}`)),
      ...GIT_STATUS.unstaged.map((f) => line(" ", t(`${f.code}`, "danger"), ` ${f.path}`)),
      ...GIT_STATUS.untracked.map((p) => line(t("??", "danger"), ` ${p}`)),
    ];
    return {
      blocks: [
        lines(...shown),
        { kind: "panel", command: "git status -s", label: "Staged, kept apart", panel: { kind: "git-status", ...GIT_STATUS } },
      ],
    };
  }
  if (sub === "status") {
    return {
      blocks: [
        lines(
          line("On branch main"),
          line("Changes to be committed:"),
          ...GIT_STATUS.staged.map((f) => line(t(`        ${f.code === "A" ? "new file" : "modified"}:   ${f.path}`, "mint"))),
          line(""),
          line("Changes not staged for commit:"),
          ...GIT_STATUS.unstaged.map((f) => line(t(`        modified:   ${f.path}`, "danger"))),
          line(""),
          line(t("tip: git status -s gets the panel — JKY reads the short form.", "dim")),
        ),
      ],
    };
  }
  if (sub === "log") {
    const out: Line[] = [];
    for (const c of COMMITS) {
      out.push(line(t(`commit ${c.hash}`, "warn"), c.head ? t(" (HEAD -> main)", "accent") : ""));
      out.push(line(`Date:   ${c.when}`));
      out.push(line(""));
      out.push(line(`    ${c.subject}`));
      out.push(line(""));
    }
    return {
      blocks: [lines(...out), { kind: "panel", command: "git log", label: "Timeline", panel: { kind: "git-log", commits: COMMITS } }],
    };
  }
  return { blocks: [lines(line(t(`git: '${sub ?? ""}' is not something this demo knows — try git status -s`, "danger")))] };
}

/** Runs one command line. Unknown input gets the shell's own answer. */
export function run(input: string, ctx: ShellContext, cwd: string): Result {
  const trimmed = input.trim();
  if (!trimmed) return { blocks: [] };

  // A pipe: run the left side, filter it, and let the recogniser decline —
  // the app never guesses at output something else has rewritten.
  if (trimmed.includes("|")) {
    const [left, right] = trimmed.split("|").map((s) => s.trim());
    const grep = /^grep\s+(?:-i\s+)?["']?([^"']+)["']?$/.exec(right ?? "");
    if (/^docker\s+ps$/.test(left) && grep) {
      return {
        blocks: [lines(...dockerTable(grep[1])), { kind: "note", text: "Piped through grep, so no panel: JKY only reads output it knows is unedited." }],
      };
    }
    return {
      blocks: [lines(line(t("This demo pipes only docker ps | grep <word>. JKY pipes anything — it is your shell.", "dim")))],
    };
  }

  const argv = words(trimmed);
  const [cmd, ...args] = argv;

  switch (cmd) {
    case "help":
    case "?":
      return help();
    case "clear":
    case "cls":
      return { blocks: [], effects: { clear: true } };
    case "jky":
      return jky(args, ctx);
    case "ask":
    case "claude":
      return ask(args);
    case "docker":
      if (args[0] === "ps") {
        return {
          blocks: [
            lines(...dockerTable()),
            {
              kind: "panel",
              command: "docker ps",
              label: "Containers · live",
              panel: {
                kind: "docker",
                containers: CONTAINERS.map((c) => ({ id: c.id, name: c.name, image: c.image, status: c.status, up: c.status.startsWith("Up"), ports: c.ports })),
              },
            },
          ],
        };
      }
      return { blocks: [lines(line(t("docker: this demo knows docker ps", "danger")))] };
    case "git":
      return git(args);
    case "df": {
      const out = [
        line(t(`${pad("Filesystem", 16)}${pad("Size", 6)}${pad("Used", 6)}${pad("Avail", 6)}${pad("Use%", 5)}Mounted on`, "dim")),
        ...DISKS.map((d) =>
          line(`${pad(d.fs, 16)}${pad(d.size, 6)}${pad(d.used, 6)}${pad(d.avail, 6)}`, t(pad(`${d.pct}%`, 5), d.pct >= 90 ? "warn" : "text"), d.mount),
        ),
      ];
      return {
        blocks: [
          lines(...out),
          {
            kind: "panel",
            command: "df -h",
            label: "Fullest first · live",
            panel: { kind: "df", disks: DISKS.map((d) => ({ mount: d.mount, used: d.used, size: d.size, pct: d.pct })) },
          },
        ],
      };
    }
    case "ls": {
      if (!args.includes("-l")) {
        return { blocks: [lines(line(...FILES.map((f) => t(`${f.name}${f.dir ? "/" : ""}  `, f.dir ? "accent" : "text"))))] };
      }
      return {
        blocks: [
          lines(
            line(t("total 24", "dim")),
            ...FILES.map((f) =>
              line(t(f.dir ? "drwxr-xr-x" : "-rw-r--r--", "dim"), `  you  ${pad(f.size, 5)} ${f.date}  `, t(f.name, f.dir ? "accent" : "text")),
            ),
          ),
          { kind: "panel", command: "ls -l", label: "Listing", panel: { kind: "ls", entries: FILES } },
        ],
      };
    }
    case "cat":
      if (args[0] === "package.json") {
        const json = JSON.stringify(PACKAGE, null, 2).split("\n").map((l) => line(l));
        return { blocks: [lines(...json), { kind: "panel", command: "cat package.json", label: "JSON tree", panel: { kind: "json", value: PACKAGE } }] };
      }
      if (args[0] === "README.md") return { blocks: [lines(line("# acme/api"), line(""), line("Orders, payments and the health endpoint."))] };
      if (args[0] === "tsconfig.json") return { blocks: [lines(line('{ "compilerOptions": { "strict": true, "outDir": "dist" } }'))] };
      return { blocks: [lines(line(t(`cat: ${args[0] ?? ""}: No such file or directory`, "danger")))] };
    case "mkdir": {
      const dir = args.find((a) => !a.startsWith("-"));
      if (!dir) return { blocks: [lines(line(t("mkdir: missing operand", "danger")))] };
      return { blocks: [{ kind: "panel", command: `mkdir ${dir}`, label: "Created", panel: { kind: "mkdir", dir } }] };
    }
    case "npm":
      if (args[0] === "run" && args[1] === "build") {
        return {
          blocks: [
            lines(
              line(t("> acme-api@2.4.0 build", "dim")),
              line(t("> tsc -p .", "dim")),
              line(""),
              line(t("✓", "mint"), " compiled 48 files in 2.1s"),
            ),
          ],
        };
      }
      if (args[0] === "test") {
        return { blocks: [lines(line(t(" ✓ ", "mint"), "tests/orders.test.ts (12)"), line(t(" ✓ ", "mint"), "tests/health.test.ts (3)"), line(""), line(t(" Test Files  2 passed (2)", "mint")))] };
      }
      return { blocks: [lines(line(t("npm: try npm run build", "dim")))] };
    case "pwd":
      return { blocks: [lines(line(cwd.replace("~", "/home/you")))] };
    case "whoami":
      return { blocks: [lines(line("you"))] };
    case "echo":
      return { blocks: [lines(line(args.join(" ")))] };
    case "date":
      return { blocks: [lines(line(new Date().toString().replace(/\s*\(.*\)$/, "")))] };
    case "exit":
      return { blocks: [], effects: { exit: true } };
    case "sudo":
      return { blocks: [lines(line(t("JKY never asks for sudo — even its installer installs for you alone.", "muted")))] };
    case "rm":
      return {
        blocks: [
          lines(
            line(t("Not in a demo. ", "muted"), t("In JKY, an assistant that proposed this would have to ask,", "muted")),
            line(t("and you would have to type the target back before it ran.", "muted")),
          ),
        ],
      };
    case "vim":
    case "nvim":
    case "nano":
    case "emacs":
      return { blocks: [lines(line(t(`${cmd} runs fine in JKY — a real PTY. This page only pretends to be one.`, "muted")))] };
    default:
      return {
        blocks: [lines(line(t(`zsh: command not found: ${cmd}`, "danger")), line(t("type help to see what this demo knows", "dim")))],
      };
  }
}
