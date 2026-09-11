import { PROVIDERS, findProvider, toStatus, validateKey } from "./catalogue";
import { DEFAULT_BINDINGS, conflictsIn } from "./keymap";
import type {
  CompleteApi,
  LiveApi,
  FileEntry,
  FilesApi,
  LifecycleApi,
  Folder,
  SavedWorkspace,
  WorkspaceApi,
  Workspaces,
  RemoteApi,
  RemoteHost,
  HistoryApi,
  HistoryEntry,
  HistoryHit,
  Keyboard,
  KeysApi,
  CaptureApi,
  GmailMessage,
  SystemReading,
  AppsApi,
  BrowserApi,
  AiApi,
  CollectionApi,
  CommandSpec,
  Event,
  GamesApi,
  Note,
  Platform,
  ProviderStatus,
  PtyApi,
  Reminder,
  ScrollbackApi,
  SettingsApi,
  StoreApi,
  Todo,
  ToolRan,
  ToolRequest,
  VaultApi,
} from "./types";

/**
 * Development-only backend.
 *
 * Values live in closures and die with the tab. Deliberately NOT localStorage
 * or sessionStorage — the browser build must never write credentials to disk.
 */
/**
 * Mirror of `commands()` in crates/jky-pty/src/commands.rs.
 *
 * The desktop build reads the real catalogue over IPC; this exists so the
 * browser build and the tests see the same list. A test parses the Rust
 * source and fails if the two ever disagree.
 */
const WEB_COMMANDS: CommandSpec[] = [
  {
    names: ["jky-terminal", "jkyterminal", "jkyTerminal"],
    usage: "jky-terminal",
    summary: "Print the JKY Terminal banner",
    detail:
      "Reprints the wordmark shown when a terminal opens, in the theme that terminal started with. Three spellings work because people type what they remember.",
  },
  {
    names: ["jky ask", "jky asks"],
    usage: "jky ask <question>",
    summary: "Ask the assistant without leaving the terminal",
    detail:
      "Sends the question to the Assistant panel and brings it into view. Everything after the word ask is the question, so quotes are not needed.",
  },
  {
    names: ["jky commands", "jky command"],
    usage: "jky commands",
    summary: "List every JKY command",
    detail: "Prints this list. The same list appears under Settings, Commands.",
  },
  {
    names: ["jky games", "jky game"],
    usage: "jky games [1-4]",
    summary: "List the games and their records, or open one",
    detail:
      "With no argument it prints all four games with the best score each has been beaten with. Give it 1, 2, 3 or 4 and that game opens in the window: 1 Dino Run, 2 Snake, 3 Tic Tac Toe, 4 Flappy Bird.",
  },
  {
    names: ["jky notes", "jky note"],
    usage: "jky notes [number]",
    summary: "List your notes, or read one",
    detail:
      "With no argument it prints every saved note, numbered from one. Give it a number and it prints that note in full. The numbers follow the list, so deleting one renumbers the rest.",
  },
  {
    names: ["jky reminders", "jky reminder"],
    usage: "jky reminders [number]",
    summary: "List your reminders, or read one",
    detail:
      "The daily checklist in the order of the day, ticked or not, numbered from one. Give it a number to see one on its own.",
  },
  {
    names: ["jky todos", "jky todo"],
    usage: "jky todos [number]",
    summary: "List your todos, or read one",
    detail:
      "Everything on the list, numbered from one, done and not done. Nothing is removed for being finished.",
  },
  {
    names: ["jky note new", "jky note add"],
    usage: "jky note new <title>",
    summary: "Create a note without leaving the shell",
    detail:
      "Everything after new is the title, so quotes are not needed. It appears in the Notes panel at once — there is no second way to write a note, this goes through the same store the panel does.",
  },
  {
    names: ["jky note write", "jky note append"],
    usage: "jky note write <n> <text>",
    summary: "Add a line to a note",
    detail:
      "Appended, never replaced: a command that silently discarded a note's body the moment you added a line to it would be a trap. The number is the one jky notes prints beside it.",
  },
  {
    names: ["jky note rename"],
    usage: "jky note rename <n> <title>",
    summary: "Give a note a new title",
    detail:
      "The body is untouched. Numbers follow the listing, so run jky notes first if anything has been deleted since.",
  },
  {
    names: ["jky note rm", "jky note delete"],
    usage: "jky note rm <n>",
    summary: "Delete a note",
    detail:
      "Immediate and not recoverable, unlike the Dashboard, which asks first. A shell is a place where people expect rm to mean rm.",
  },
  {
    names: ["jky todo add", "jky todo new"],
    usage: "jky todo add <text>",
    summary: "Add something to the list",
    detail:
      "Everything after add is the text. It arrives not done, and shows up in the notification tray like any other open todo.",
  },
  {
    names: ["jky todo done", "jky todo tick"],
    usage: "jky todo done <n>",
    summary: "Tick a todo off",
    detail:
      "Nothing is removed for being finished — a ticked todo stays on the list. jky todo undone puts it back.",
  },
  {
    names: ["jky todo undone", "jky todo untick"],
    usage: "jky todo undone <n>",
    summary: "Put a todo back on the list",
    detail:
      "The other half of done, for when something turns out not to have been finished after all.",
  },
  {
    names: ["jky todo rm", "jky todo delete"],
    usage: "jky todo rm <n>",
    summary: "Delete a todo",
    detail:
      "Immediate. Ticking one off with done is what you want if you only meant to finish it.",
  },
  {
    names: ["jky reminder add", "jky reminder new"],
    usage: "jky reminder add <HH:MM> <text>",
    summary: "Set a daily reminder",
    detail:
      "The time is a wall clock, because a reminder is a daily checklist rather than a date: 07:00 means seven in the morning wherever you are. Everything after it is the text.",
  },
  {
    names: ["jky reminder done", "jky reminder tick"],
    usage: "jky reminder done <n>",
    summary: "Tick a reminder off for today",
    detail:
      "Numbers follow the listing, which is in order of the day rather than the order they were added.",
  },
  {
    names: ["jky reminder rm", "jky reminder delete"],
    usage: "jky reminder rm <n>",
    summary: "Delete a reminder",
    detail:
      "Immediate, and it stops appearing tomorrow too.",
  },
  {
    names: ["jky theme"],
    usage: "jky theme <name>",
    summary: "Change the theme from the shell",
    detail:
      "One of cyberpunk, dracula, nord, solarized, light, gold or contrast. Applied at once and remembered, exactly as choosing it in Settings would be.",
  },
  {
    names: ["jky open", "jky go"],
    usage: "jky open <section>",
    summary: "Jump to a section",
    detail:
      "One of dashboard, terminal, history, remote, editor, workspaces, assistant, games, apps, developer or settings. A second word opens a panel inside it, so jky open dashboard calendar goes straight there.",
  },
  {
    names: ["jky split"],
    usage: "jky split [down]",
    summary: "Divide this terminal in two",
    detail:
      "Puts another terminal beside this one, or below it with the word down. The same as Ctrl+Shift+T and Ctrl+Shift+D, for when your hands are already on the keys.",
  },
  {
    names: ["jky history", "jky hist"],
    usage: "jky history [text]",
    summary: "Search everything you have run",
    detail:
      "Prints the closest matches without leaving the terminal. The text is matched as a subsequence, so dkrps finds docker ps. With no text it opens the History section instead.",
  },
  {
    names: ["jky workspace", "jky ws"],
    usage: "jky workspace [name]",
    summary: "List your workspaces, or switch to one",
    detail:
      "With no name it prints every saved workspace and marks the one you are in. Give it a name and it opens that workspace's folders and terminals, exactly as clicking it would.",
  },
  {
    names: ["jky host", "jky hosts"],
    usage: "jky host [name]",
    summary: "List saved machines, or open a terminal on one",
    detail:
      "With no name it prints every host you have saved. Give it one and a terminal opens on that machine, over the ssh this computer already has.",
  },
  {
    names: ["jky banner"],
    usage: "jky banner",
    summary: "Print the banner",
    detail:
      "The same output as jky-terminal, reachable through the jky command for consistency.",
  },
];

/**
 * A mailbox for the preview build.
 *
 * Chosen to cover the states the panel has to draw differently rather than to
 * look plausible: read and unread, a sender with a display name and one with
 * only an address, a long subject that has to truncate, and a message old
 * enough that a clock time would be useless where a date is not.
 */
const PREVIEW_MAIL: GmailMessage[] = [
  {
    id: "18f0a1",
    thread_id: "18f0a1",
    from_name: "Ada Lovelace",
    from_address: "ada@example.com",
    subject: "Deploy finished",
    snippet: "The deploy finished and the smoke tests are green. Nothing to do.",
    received_ms: Date.parse("2026-08-31T12:00:00Z"),
    unread: true,
  },
  {
    id: "18f0a2",
    thread_id: "18f09f",
    from_name: "billing@example.net",
    from_address: "billing@example.net",
    subject: "Receipt",
    snippet: "Your receipt is attached.",
    received_ms: Date.parse("2026-08-30T09:14:00Z"),
    unread: false,
  },
  {
    id: "18f0a3",
    thread_id: "18f0a3",
    from_name: "Grace Hopper",
    from_address: "grace@example.org",
    subject: "Re: the scheduling change we discussed on Tuesday and what it means for the release",
    snippet: "Happy either way — say which you would prefer and I will move it.",
    received_ms: Date.parse("2026-08-24T17:40:00Z"),
    unread: true,
  },
];

/** What the preview's messages say when opened. */
const PREVIEW_BODIES: Record<string, string> = {
  "18f0a1":
    "Hi \u2014 the deploy finished and the smoke tests are green.\n\nNothing to do, but the " +
    "release notes still need a line about the cache change.\n\n-- \nAda",
  "18f0a2": "Your receipt is attached.\n\nThanks for your custom.",
  "18f0a3":
    "Happy either way \u2014 say which you would prefer and I will move it.\n\nThe only fixed " +
    "point is the Thursday review.",
};

export function createWebPlatform(): Platform {
  const keys = new Map<string, string>();
  const models = new Map<string, string>();

  const vault: VaultApi = {
    async setSecret(provider, value) {
      const spec = findProvider(provider);
      if (!spec) throw new Error(`unknown provider '${provider}'`);
      validateKey(spec, value);
      keys.set(provider, value);
    },
    async hasSecret(provider) {
      return keys.has(provider);
    },
    async deleteSecret(provider) {
      keys.delete(provider);
    },
    async listProviders(): Promise<ProviderStatus[]> {
      return PROVIDERS.map((spec) =>
        toStatus(spec, keys.has(spec.id), models.get(spec.id) ?? null),
      );
    },
  };

  const settings: SettingsApi = {
    async setSelectedModel(provider, model) {
      if (!findProvider(provider)) throw new Error(`unknown provider '${provider}'`);
      if (!model.trim()) throw new Error("model id cannot be empty");
      models.set(provider, model.trim());
    },
    async setActiveProvider(provider) {
      if (!findProvider(provider)) throw new Error(`unknown provider '${provider}'`);
    },
  };

  /*
   * The keymap, in memory.
   *
   * It enforces the same two rules the Rust one does — a binding needs a
   * modifier, and a chord another action holds is refused — because a browser
   * build that let you bind a bare letter would teach a habit the desktop
   * build then refuses.
   */
  const custom = new Map<string, string>();

  function keyboardNow(): Keyboard {
    const bindings = DEFAULT_BINDINGS.map((b) => ({
      ...b,
      chord: custom.get(b.action) ?? b.default_chord,
      custom: custom.has(b.action),
    }));
    return { bindings, conflicts: conflictsIn(bindings) };
  }

  const keyboard: KeysApi = {
    async list() {
      return keyboardNow();
    },
    async bind(action, chord) {
      const target = DEFAULT_BINDINGS.find((b) => b.action === action);
      if (!target) throw new Error(`'${action}' is not something this app can do`);

      const modified = /^(Ctrl|Alt)\+/.test(chord);
      if (!modified) {
        throw new Error(
          `\`${chord}\` has no modifier. An unmodified key belongs to the shell, where every ` +
            "keystroke means something",
        );
      }

      const taken = keyboardNow().bindings.find(
        (b) => b.action !== action && b.chord === chord,
      );
      if (taken) throw new Error(`${chord} is already ${taken.label}`);

      // A binding equal to the default is an absence, not an entry.
      if (chord === target.default_chord) custom.delete(action);
      else custom.set(action, chord);
      return keyboardNow();
    },
    async reset(action) {
      custom.delete(action);
      return keyboardNow();
    },
    async resetAll() {
      custom.clear();
      return keyboardNow();
    },
  };

  /*
   * Command history, in memory.
   *
   * The match is the same subsequence rule the Rust one uses, so `dkrps`
   * finds `docker ps` here too. The *ranking* is not: tightness, frequency
   * and recency are weighted in `jky-history`, tested against a hundred
   * entries, and duplicating that arithmetic here would give two answers to
   * one question. This orders by recency and says so.
   */
  const commands: HistoryEntry[] = [];

  const subsequence = (haystack: string, needle: string): boolean => {
    let at = 0;
    for (const c of needle) {
      at = haystack.indexOf(c, at) + 1;
      if (at === 0) return false;
    }
    return true;
  };

  const history: HistoryApi = {
    async record(entry) {
      const command = entry.command.trim();
      if (!command) return;
      commands.push({ ...entry, command });
    },
    async search(query) {
      const needle = query.text.trim().toLowerCase();
      const seen = new Map<string, HistoryHit>();

      // Newest first, keeping the first sighting of each command: a search
      // that returned the same line forty times would bury everything else.
      for (const entry of [...commands].reverse()) {
        if (query.failedOnly && entry.code === 0) continue;
        if (query.session && entry.session !== query.session) continue;
        if (query.cwd && entry.cwd !== query.cwd) continue;
        if (!subsequence(entry.command.toLowerCase(), needle)) continue;

        const already = seen.get(entry.command);
        if (already) already.count += 1;
        else seen.set(entry.command, { ...entry, count: 1, last_at: entry.at });
      }

      // Every earlier run still counts, even one filtered out of the view:
      // how often a command has run is a fact about the history.
      for (const hit of seen.values()) {
        hit.count = commands.filter((e) => e.command === hit.command).length;
      }

      return [...seen.values()].slice(0, query.limit && query.limit > 0 ? query.limit : 200);
    },
    async forget(command) {
      const before = commands.length;
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        if (commands[i].command === command) commands.splice(i, 1);
      }
      return before - commands.length;
    },
    async clear() {
      commands.length = 0;
    },
  };

  /*
   * Completions, in the browser.
   *
   * There is no filesystem here and no PATH, so the only source that can
   * honestly answer is the history this build already keeps. It offers whole
   * lines and nothing else rather than inventing a directory listing: a made
   * up path is not an illustrative placeholder the way a made up inbox is —
   * it is a wrong answer to the exact question that was asked.
   */
  const complete: CompleteApi = {
    async suggest(line, cursor, _cwd, limit) {
      const at = Math.max(0, Math.min(cursor, line.length));
      const typed = line.slice(0, at);
      const wordStart = typed.lastIndexOf(" ") + 1;

      const seen = new Set<string>();
      const items = commands
        .map((entry) => entry.command)
        .reverse()
        .filter((c) => c.toLowerCase().startsWith(typed.trim().toLowerCase()))
        .filter((c) => typed.trim().length > 0 && c.length > typed.length)
        .filter((c) => (seen.has(c) ? false : seen.add(c)))
        .slice(0, limit > 0 ? limit : 40)
        .map((c) => ({ value: c, display: c, kind: "history" as const, detail: "", from: 0 }));

      return { start: wordStart, end: at, word: typed.slice(wordStart), items };
    },
  };

  /*
   * Saved machines, in memory.
   *
   * The same two refusals the Rust one makes — an address or a user that ssh
   * would read as an option, and one carrying anything a shell would notice —
   * because a browser build that let you save a host the desktop build will
   * not connect to is a browser build that teaches the wrong thing. Connecting
   * is the one part that cannot be faked: there is no process to start here,
   * so it says so.
   */
  const hosts: RemoteHost[] = [];

  const optionLike = (value: string) => value.trim().startsWith("-");
  const addressOk = (value: string) => /^[A-Za-z0-9.\-_:%]+$/.test(value);
  const userOk = (value: string) => /^[A-Za-z0-9.\-_\\]+$/.test(value);

  function refuse(host: RemoteHost): string | null {
    const address = host.address.trim();
    if (!address) return "a host needs an address";
    if (optionLike(address)) {
      return `\`${address}\` cannot start with a dash. ssh would read it as an option rather ` +
        "than a name, which is how a hostname becomes a command";
    }
    if (!addressOk(address)) return `\`address\` contains something that is not allowed in one`;

    const user = host.user.trim();
    if (user && optionLike(user)) return `\`${user}\` cannot start with a dash`;
    if (user && !userOk(user)) return "`user` contains something that is not allowed in one";
    if (host.port === 0) return "a port of 0 is not a port";
    return null;
  }

  const byRecent = (list: RemoteHost[]) =>
    [...list].sort(
      (a, b) =>
        b.last_used - a.last_used ||
        (a.label || a.address).localeCompare(b.label || b.address),
    );

  const remote: RemoteApi = {
    async list() {
      return byRecent(hosts);
    },
    async save(host) {
      const wrong = refuse(host);
      if (wrong) throw new Error(wrong);

      const at = hosts.findIndex((h) => h.id === host.id);
      // Renaming a machine is not using it, so `last_used` survives an edit.
      if (at === -1) hosts.push(host);
      else hosts[at] = { ...host, last_used: hosts[at].last_used };
      return byRecent(hosts);
    },
    async forget(id) {
      const at = hosts.findIndex((h) => h.id === id);
      if (at === -1) throw new Error("no host with that id");
      hosts.splice(at, 1);
      return byRecent(hosts);
    },
    async spawn() {
      // The one thing a browser cannot do. Saying so is better than a fake
      // shell pretending to be somebody's production machine.
      throw new Error("connecting to another machine needs the desktop app");
    },
  };

  /*
   * A small in-memory tree, so the editor can be worked on in a browser.
   *
   * Not a filesystem and not pretending to be one: `openFolder` accepts what
   * it is given and the tree below is what there is. The rules it does keep
   * are the two that matter — a path that climbs out is refused, and a root
   * that was never opened is not readable — so a bug in the window is caught
   * in the build most of the tests run in.
   */
  const trees = new Map<string, Map<string, string>>([
    [
      "/tmp/sample",
      new Map([
        ["README.md", "# Sample\n\nThe browser build has no filesystem.\n"],
        ["src/main.ts", 'export const hello = () => "hi";\n'],
      ]),
    ],
    ["/tmp/other", new Map([["notes.txt", "second folder\n"]])],
  ]);
  const openFolders: string[] = [];

  const escapes = (path: string) =>
    path.startsWith("/") || path.split("/").some((part) => part === "..");

  const nameOf = (dir: string) =>
    dir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || dir;

  const folderList = (): Folder[] =>
    openFolders.map((root) => ({ root, name: nameOf(root), available: trees.has(root) }));

  /** The tree for a root, refusing one nobody opened. */
  function treeOf(root: string): Map<string, string> {
    if (!openFolders.includes(root)) {
      throw new Error("no folder is open. Open one in the Editor");
    }
    const tree = trees.get(root);
    if (!tree) throw new Error(`could not read \`${root}\``);
    return tree;
  }

  /*
   * Keeping a panel live, in the browser.
   *
   * There is no process to run, so it answers with something that parses the
   * way the real thing does and changes a little each time — enough to work
   * on the panel, and honest about being a stand-in.
   */
  let liveTick = 0;
  const live: LiveApi = {
    async sources() {
      return [
        { id: "df", program: "df", args: ["-h"], shown: "df -h" },
        { id: "ps", program: "ps", args: ["aux"], shown: "ps aux" },
        { id: "docker-ps", program: "docker", args: ["ps"], shown: "docker ps" },
      ];
    },
    async run(source) {
      liveTick += 1;
      if (source === "df") {
        const used = 40 + (liveTick % 12);
        return {
          text: [
            "Filesystem      Size  Used Avail Use% Mounted on",
            `/dev/sda1       100G   ${used}G   ${100 - used}G  ${used}% /`,
          ].join("\n"),
          code: 0,
        };
      }
      if (source === "ps") {
        return {
          text: [
            "USER  PID %CPU %MEM    VSZ   RSS TTY STAT START TIME COMMAND",
            `you   ${100 + liveTick}  ${liveTick % 9}.0  1.0 100000 20000 ?   S    10:00 0:01 node`,
          ].join("\n"),
          code: 0,
        };
      }
      if (source === "docker-ps") {
        return {
          text: [
            "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS          PORTS   NAMES",
            `abc12345678    nginx   "x"       1 min     Up ${liveTick} minutes           web`,
          ].join("\n"),
          code: 0,
        };
      }
      throw new Error(`\`${source}\` is not something this app knows how to keep live`);
    },
  };

  const files: FilesApi = {
    async preview(root, path) {
      const tree = treeOf(root);
      if (escapes(path)) throw new Error(`\`${path}\` is outside the open folder`);
      if (!tree.has(path)) throw new Error(`could not read \`${path}\``);

      // There are no real bytes here, so it answers with the shape of one
      // rather than inventing a picture.
      const name = path.toLowerCase();
      if (/\.(png|jpe?g|gif|webp|bmp|ico|avif)$/.test(name)) {
        return { kind: "image" as const, mime: "image/png", size: 0, data: null, note: "the browser build has no bytes to draw" };
      }
      if (name.endsWith(".pdf")) {
        return { kind: "pdf" as const, mime: "application/pdf", size: 0, data: null, note: "PDFs cannot be shown in this window yet" };
      }
      return { kind: "binary" as const, mime: "application/octet-stream", size: 0, data: null, note: "there is no useful way to show this" };
    },
    async create(root, path, folder) {
      const tree = treeOf(root);
      if (escapes(path)) throw new Error(`\`${path}\` is outside the open folder`);
      const name = path.replace(/\/+$/, "").split("/").pop() ?? "";
      if (!name.trim()) throw new Error("a name cannot be empty");
      if (tree.has(path)) throw new Error(`\`${path}\` is already there`);
      // A directory has no entry of its own here; it exists because a file
      // under it does. A new empty one is remembered by a marker so the tree
      // can show it before anything is put in.
      tree.set(folder ? `${path}/.keep` : path, "");
    },
    async rename(root, from, to) {
      const tree = treeOf(root);
      if (escapes(from) || escapes(to)) throw new Error("outside the open folder");
      const text = tree.get(from);
      if (text === undefined) throw new Error(`could not read \`${from}\``);
      if (tree.has(to)) throw new Error(`\`${to}\` is already there`);
      tree.delete(from);
      tree.set(to, text);
    },
    async remove(root, path) {
      const tree = treeOf(root);
      if (escapes(path)) throw new Error(`\`${path}\` is outside the open folder`);
      if (tree.has(path)) {
        tree.delete(path);
        return;
      }
      // A directory: refused unless nothing is under it, the way Rust does.
      const prefix = `${path.replace(/\/+$/, "")}/`;
      const under = [...tree.keys()].filter((k) => k.startsWith(prefix));
      const real = under.filter((k) => !k.endsWith("/.keep"));
      if (real.length > 0) throw new Error(`\`${path}\` is not empty`);
      if (under.length === 0) throw new Error(`could not read \`${path}\``);
      for (const key of under) tree.delete(key);
    },
    async folders() {
      return folderList();
    },
    async openFolder(dir) {
      const trimmed = dir.trim();
      if (!trimmed) return folderList();
      if (!trees.has(trimmed)) throw new Error(`could not read \`${trimmed}\``);
      if (!openFolders.includes(trimmed)) openFolders.push(trimmed);
      return folderList();
    },
    async closeFolder(dir) {
      const at = openFolders.indexOf(dir);
      if (at !== -1) openFolders.splice(at, 1);
      return folderList();
    },
    async list(root, path) {
      const tree = treeOf(root);
      const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
      const seen = new Map<string, FileEntry>();

      for (const full of tree.keys()) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        const cut = rest.indexOf("/");
        const name = cut === -1 ? rest : rest.slice(0, cut);
        if (!name) continue;
        seen.set(name, {
          path: prefix + name,
          name,
          is_dir: cut !== -1,
          size: cut === -1 ? (tree.get(full)?.length ?? 0) : 0,
        });
      }
      return [...seen.values()].sort(
        (a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name),
      );
    },
    async read(root, path) {
      const tree = treeOf(root);
      if (escapes(path)) throw new Error(`\`${path}\` is outside the open folder`);
      const text = tree.get(path);
      if (text === undefined) throw new Error(`could not read \`${path}\``);
      return text;
    },
    async write(root, path, text) {
      const tree = treeOf(root);
      if (escapes(path)) throw new Error(`\`${path}\` is outside the open folder`);
      tree.set(path, text);
    },
  };

  /*
   * Saved workspaces, in memory.
   *
   * Switching does here what it does in Rust: replaces the open folders with
   * the ones the workspace names, and reports rather than deletes any that
   * are not there.
   */
  const saved: SavedWorkspace[] = [];
  let activeWorkspace: string | null = null;

  const byRecentWorkspace = (): Workspaces => ({
    workspaces: [...saved].sort(
      (a, b) => b.last_used - a.last_used || a.name.localeCompare(b.name),
    ),
    active: activeWorkspace,
  });

  const workspaces: WorkspaceApi = {
    async list() {
      return byRecentWorkspace();
    },
    async save(workspace) {
      const name = workspace.name.trim();
      if (!name) throw new Error("a workspace needs a name");
      if (saved.some((w) => w.id !== workspace.id && w.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`\`${name}\` is already the name of a workspace`);
      }

      const at = saved.findIndex((w) => w.id === workspace.id);
      // Editing is not using, so `last_used` survives a rename.
      if (at === -1) saved.push({ ...workspace, name });
      else saved[at] = { ...workspace, name, last_used: saved[at].last_used };
      return byRecentWorkspace();
    },
    async forget(id) {
      const at = saved.findIndex((w) => w.id === id);
      if (at === -1) throw new Error("no workspace with that id");
      saved.splice(at, 1);
      if (activeWorkspace === id) activeWorkspace = null;
      return byRecentWorkspace();
    },
    async activate(id) {
      const found = saved.find((w) => w.id === id);
      if (!found) throw new Error("no workspace with that id");
      found.last_used = Date.now();
      activeWorkspace = id;

      const missing = found.folders.filter((f) => !trees.has(f));
      openFolders.length = 0;
      for (const folder of found.folders) {
        if (trees.has(folder)) openFolders.push(folder);
      }

      // The start directory is checked the way a folder is: applying one that
      // is not there would open every terminal in the wrong place silently.
      const wanted = found.terminal_dir?.trim() || null;
      const dirMissing = wanted !== null && !trees.has(wanted);

      return {
        workspace: found,
        folders: [...openFolders],
        missing,
        terminal_dir: dirMissing ? null : wanted,
        terminal_dir_missing: dirMissing,
      };
    },
    async leave() {
      activeWorkspace = null;
      return byRecentWorkspace();
    },
  };

  /*
   * The window's life, in a browser.
   *
   * `beforeunload` is the nearest thing a page has to being asked whether it
   * may close, and it is deliberately not the same: a browser shows its own
   * wording and a page cannot replace it. So the handler's answer only
   * decides whether to ask at all.
   */
  const lifecycle: LifecycleApi = {
    async onCloseRequested(handler) {
      const onBefore = (e: BeforeUnloadEvent) => {
        if (handler()) return;
        e.preventDefault();
      };
      window.addEventListener("beforeunload", onBefore);
      return () => window.removeEventListener("beforeunload", onBefore);
    },
    async close() {
      // A page cannot close itself unless it opened itself, and pretending
      // otherwise would be worse than doing nothing.
    },
  };

  // A fake shell so the browser build and the test suite exercise the same
  // interface as the desktop build, where a real pty exists.
  const ptyHandlers = new Map<string, (chunk: string) => void>();
  let ptyCounter = 0;

  const pty: PtyApi = {
    async spawn(_cols, _rows, _banner, _accent) {
      // Deliberately silent. The prompt is emitted when a handler subscribes,
      // not here: spawn resolves before onData registers, so anything emitted
      // at spawn time is written to nobody.
      return `web-pty-${++ptyCounter}`;
    },
    async write(id, data) {
      // Echo input back the way a real pty does, and answer Enter with a prompt.
      ptyHandlers.get(id)?.(data === "\r" ? "\r\njky $ " : data);
    },
    async resize() {},
    async kill(id) {
      ptyHandlers.delete(id);
    },
    async onData(id, handler) {
      ptyHandlers.set(id, handler);
      return () => ptyHandlers.delete(id);
    },
    async attach(id) {
      // Mirrors the real backend: the prompt appears when the stream starts,
      // which is attach time, not spawn time.
      ptyHandlers.get(id)?.("jky $ ");
    },
  };

  // A fake assistant so the panel is developable in a browser. It streams a
  // canned reply word by word, which is enough to exercise the same code path
  // the real provider drives.
  const aiHandlers = {
    delta: [] as Array<(t: string) => void>,
    tool: [] as Array<(r: ToolRequest) => void>,
    ran: [] as Array<(r: ToolRan) => void>,
    done: [] as Array<(s: string) => void>,
    error: [] as Array<(m: string) => void>,
  };

  const ai: AiApi = {
    // The preview build has no key and no local runtime, so it answers the
    // way the real one does when neither is configured: by saying so.
    async askOnce() {
      throw new Error("add an API key, or run Ollama, to get suggestions");
    },
    async send(_provider, conversation) {
      const last = conversation[conversation.length - 1];
      const first = last?.content[0];
      const asked = first && first.type === "text" ? first.text : "";
      for (const word of `You said: ${asked}`.split(" ")) {
        aiHandlers.delta.forEach((h) => h(`${word} `));
      }
      aiHandlers.done.forEach((h) => h("end_turn"));
    },
    async cancel() {
      aiHandlers.done.forEach((h) => h("cancelled"));
    },
    async approveTool() {},
    async rejectTool() {},
    async onDelta(h) {
      aiHandlers.delta.push(h);
      return () => {
        aiHandlers.delta.splice(aiHandlers.delta.indexOf(h), 1);
      };
    },
    async onToolRequest(h) {
      aiHandlers.tool.push(h);
      return () => {
        aiHandlers.tool.splice(aiHandlers.tool.indexOf(h), 1);
      };
    },
    async onToolRan(h) {
      aiHandlers.ran.push(h);
      return () => {
        aiHandlers.ran.splice(aiHandlers.ran.indexOf(h), 1);
      };
    },
    async onDone(h) {
      aiHandlers.done.push(h);
      return () => {
        aiHandlers.done.splice(aiHandlers.done.indexOf(h), 1);
      };
    },
    async onError(h) {
      aiHandlers.error.push(h);
      return () => {
        aiHandlers.error.splice(aiHandlers.error.indexOf(h), 1);
      };
    },
  };

  /**
   * The browser build keeps collections in memory for the session.
   *
   * Not localStorage: the preview is for developing the UI, and a mock that
   * quietly persists would let a bug that never writes to the real store look
   * like it works. The native build is where persistence is proven.
   */
  function collection<T extends { id: string }>(seed: T[] = []): CollectionApi<T> {
    let records = [...seed];
    return {
      async list() {
        return [...records];
      },
      async save(record) {
        const i = records.findIndex((r) => r.id === record.id);
        // Replace in place. Moving an edited record to the end would reorder
        // the user's list every time they touched something.
        if (i >= 0) records[i] = record;
        else records.push(record);
        return [...records];
      },
      async remove(id) {
        records = records.filter((r) => r.id !== id);
        return [...records];
      },
    };
  }

  const store: StoreApi = {
    notes: collection<Note>(),
    todos: collection<Todo>(),
    events: collection<Event>(),
    reminders: collection<Reminder>(),
  };

  // The browser build has no shell to print a listing into, so this keeps
  // the last set handed over and does nothing else.
  const games: GamesApi = {
    async publishScores() {},
  };

  /*
   * The browser build has no Rust, so it has no way to fetch: `connect-src
   * 'self'` blocks the window from reaching Open-Meteo directly, which is the
   * whole reason the real path goes through Rust. This returns one fixed
   * reading so the panel can be developed and tested without a network, and
   * it is deliberately obvious rather than plausible — a mock that looked
   * like real weather would be mistaken for it.
   */
  // In memory for the session, like every other browser-build mock.
  // A client id ships with the real build, so the preview starts configured
  // too — otherwise the panel's first screen would differ from the desktop's.
  let githubClientId = "Ov23liPREVIEW";
  // Empty on purpose, unlike GitHub's: no Google client id ships with the
  // app, so the preview build has to be able to show the "not set up yet"
  // state the real one starts in.
  let gmailClientId = "";
  let gmailSecret = "";
  let gmailToken = false;
  let githubToken = false;
  let githubPolls = 0;

  const apps: AppsApi = {
    async weather(latitude, longitude) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("that location is not a real coordinate");
      }
      return {
        now: {
          temperature_c: 21,
          feels_like_c: 19,
          humidity_pct: 50,
          wind_kph: 10,
          code: 3,
          description: "Overcast",
          is_day: true,
          observed_at: "2026-01-01T12:00",
        },
        days: [
          { date: "2026-01-01", code: 3, description: "Overcast", high_c: 22, low_c: 14 },
          { date: "2026-01-02", code: 61, description: "Light rain", high_c: 20, low_c: 13 },
          { date: "2026-01-03", code: 0, description: "Clear", high_c: 23, low_c: 15 },
          { date: "2026-01-04", code: 95, description: "Thunderstorm", high_c: 19, low_c: 12 },
        ],
        timezone: "UTC",
      };
    },
    async newsSources() {
      return [
        { id: "thehindu", name: "The Hindu", region: "India", url: "https://example.invalid/1" },
        { id: "bbc", name: "BBC World", region: "World", url: "https://example.invalid/2" },
      ];
    },
    async news(source, limit) {
      if (limit <= 0) throw new Error("ask for at least one headline");
      // The same refusal the backend makes for an id it does not know.
      if (source !== null && !["thehindu", "bbc"].includes(source)) {
        throw new Error(`there is no paper called "${source}"`);
      }
      const name = source === "bbc" ? "BBC World" : "The Hindu";
      const id = source ?? "thehindu";
      return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        title: `Preview headline ${i + 1}`,
        link: `https://example.com/${i + 1}`,
        // The middle one carries no summary and no section, so the panel's
        // sparse branch is exercised by the browser build too.
        summary: i === 1 ? null : `A short line about story ${i + 1}.`,
        category: i === 1 ? null : "National",
        published: "Sun, 30 Aug 2026 12:00:00 +0000",
        source_id: source === "bbc" ? "bbc" : id,
        source_name: name,
        host: "example.com",
      }));
    },
    async locate() {
      return {
        name: "Sample City",
        country: "Preview",
        region: null,
        latitude: 0,
        longitude: 0,
        timezone: "UTC",
      };
    },
    async route(from, to) {
      if (![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) {
        throw new Error("that is not a real coordinate");
      }
      return { straight_m: 1_553_000, road_m: 1_988_772, duration_s: 86_168 };
    },
    /*
     * The browser build has no keychain and no device flow, so this walks the
     * same states the real one does: not configured, then configured, then
     * pending for a couple of polls, then connected. That is what lets the
     * panel's waiting screen be developed and tested without a GitHub app.
     */
    github: {
      async status() {
        return { configured: githubClientId !== "", connected: githubToken };
      },
      async setClientId(id) {
        githubClientId = id.trim();
      },
      async connectStart() {
        if (githubClientId === "") {
          throw new Error("add your GitHub OAuth client id in Settings first");
        }
        githubPolls = 0;
        return {
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          interval_s: 1,
          expires_in_s: 900,
        };
      },
      async connectPoll() {
        githubPolls += 1;
        if (githubPolls < 2) return { state: "pending" as const, interval_s: 1 };
        githubToken = true;
        return { state: "connected" as const, login: "preview-user" };
      },
      async disconnect() {
        githubToken = false;
      },
      async summary() {
        if (!githubToken) throw new Error("not connected to GitHub");
        return {
          user: {
            login: "preview-user",
            name: "Preview User",
            bio: "Focus · Build · Ship",
            avatar_url: null,
            html_url: "https://github.com/preview-user",
            public_repos: 27,
            followers: 142,
            following: 98,
          },
          repos: [
            {
              name: "jky-terminal",
              full_name: "preview-user/jky-terminal",
              private: false,
              html_url: "https://github.com/preview-user/jky-terminal",
              description: "A preview repository.",
              language: "Rust",
              stars: 12,
              open_issues: 3,
              updated_at: "2026-08-30T12:00:00Z",
            },
            {
              name: "secret-notes",
              full_name: "preview-user/secret-notes",
              private: true,
              html_url: "https://github.com/preview-user/secret-notes",
              description: null,
              language: null,
              stars: 0,
              open_issues: 0,
              updated_at: "2026-08-29T09:00:00Z",
            },
          ],
          issues: [
            {
              number: 7,
              title: "Preview issue",
              html_url: "https://github.com/preview-user/jky-terminal/issues/7",
              state: "open",
              repo: "preview-user/jky-terminal",
              is_pull_request: false,
              draft: false,
            },
          ],
          pulls: [
            {
              number: 8,
              title: "Preview pull request",
              html_url: "https://github.com/preview-user/jky-terminal/pull/8",
              state: "open",
              repo: "preview-user/jky-terminal",
              is_pull_request: true,
              draft: true,
            },
          ],
          notifications: [
            {
              id: "1",
              title: "Something needs your eyes",
              reason: "mention",
              kind: "Issue",
              repo: "preview-user/jky-terminal",
              unread: true,
              updated_at: "2026-08-31T08:00:00Z",
              html_url: "https://github.com/preview-user/jky-terminal/issues/12",
            },
          ],
          activity: [
            {
              id: "a1",
              verb: "Pushed to",
              repo: "preview-user/jky-terminal",
              detail: "main",
              html_url: "https://github.com/preview-user/jky-terminal",
              at: "2026-08-31T08:30:00Z",
            },
            {
              id: "a2",
              verb: "Merged PR",
              repo: "preview-user/jky-terminal",
              detail: "Add the apps section",
              html_url: "https://github.com/preview-user/jky-terminal/pull/8",
              at: "2026-08-30T18:00:00Z",
            },
          ],
          stars_received: 12,
          contributions: {
            total: 1337,
            weeks: Array.from({ length: 6 }, (_, w) =>
              Array.from({ length: 7 }, (_, d) => ({
                date: `2026-0${(w % 9) + 1}-0${d + 1}`,
                count: (w * 7 + d) % 9,
                level: ((w * 7 + d) % 5) as number,
              })),
            ),
          },
        };
      },
      async contents(_repo, path) {
        if (!githubToken) throw new Error("not connected to GitHub");
        if (path === "") {
          return [
            { name: "src", path: "src", is_dir: true, size: 0, html_url: "h" },
            { name: "README.md", path: "README.md", is_dir: false, size: 128, html_url: "h" },
          ];
        }
        return [
          { name: "main.rs", path: `${path}/main.rs`, is_dir: false, size: 42, html_url: "h" },
        ];
      },
      async file(_repo, path) {
        if (!githubToken) throw new Error("not connected to GitHub");
        return {
          name: path.split("/").pop() ?? path,
          path,
          size: 128,
          html_url: "h",
          text: "# Preview file\n\nContents shown by the browser build.\n",
          is_binary: false,
          too_large: false,
        };
      },
      async commits() {
        if (!githubToken) throw new Error("not connected to GitHub");
        return [
          {
            sha: "9f6aaa2b1c3d",
            short_sha: "9f6aaa2",
            subject: "feat(apps): a preview commit",
            author: "preview-user",
            date: "2026-08-30T18:33:15Z",
            html_url: "https://github.com/preview-user/jky-terminal/commit/9f6aaa2",
          },
        ];
      },
      async branches() {
        if (!githubToken) throw new Error("not connected to GitHub");
        return [
          { name: "main", protected: true },
          { name: "feat/apps", protected: false },
        ];
      },
      async notifications() {
        if (!githubToken) throw new Error("not connected to GitHub");
        return [
          {
            id: "1",
            title: "Something needs your eyes",
            reason: "mention",
            kind: "Issue",
            repo: "preview-user/jky-terminal",
            unread: true,
            updated_at: "2026-08-31T08:00:00Z",
            html_url: "https://github.com/preview-user/jky-terminal/issues/12",
          },
        ];
      },
    },
    gmail: {
      async status() {
        return {
          configured: gmailClientId !== "" && gmailSecret !== "",
          connected: gmailToken,
        };
      },
      async configure(id, secret) {
        // Both, or not at all: the mock has to be able to reach the state
        // where a panel thinks it is ready and the exchange still fails.
        if (secret.trim() === "") throw new Error("the client secret is missing");
        gmailClientId = id.trim();
        gmailSecret = secret.trim();
      },
      async connect() {
        if (gmailClientId === "" || gmailSecret === "") {
          throw new Error("add a Google client id and secret first");
        }
        gmailToken = true;
        return "preview@example.com";
      },
      async disconnect() {
        gmailToken = false;
      },
      async message(id) {
        if (!gmailToken) throw new Error("not connected to Gmail");
        const found = PREVIEW_MAIL.find((m) => m.id === id);
        if (!found) throw new Error("no such message");
        return {
          message: found,
          body: PREVIEW_BODIES[id] ?? "There is nothing to read here.",
        };
      },
      async inbox(count, query) {
        if (!gmailToken) throw new Error("not connected to Gmail");
        const all = PREVIEW_MAIL;
        const needle = query?.trim().toLowerCase() ?? "";
        // The real backend hands the query to Gmail, which searches headers
        // and bodies. Matching what a row shows is the closest a mock can
        // honestly get, and it keeps the panel's search path exercised.
        const matched =
          needle === ""
            ? all
            : all.filter((m) =>
                `${m.subject} ${m.snippet} ${m.from_name}`.toLowerCase().includes(needle),
              );
        return {
          account: { address: "preview@example.com", messages_total: 12043 },
          messages: matched.slice(0, Math.max(1, count)),
        };
      },
    },
    async searchPlaces(query) {
      // The same refusal the backend makes, so a UI that mishandles it fails
      // here rather than only on the desktop build.
      if (query.trim() === "") throw new Error("type somewhere to look for");
      return [
        {
          name: "Sample City",
          country: "Preview",
          region: null,
          latitude: 0,
          longitude: 0,
          timezone: "UTC",
        },
      ];
    },
  };

  // In memory for the session, like every other browser-build mock: the
  // preview is for developing the UI, and a mock that quietly persisted would
  // let a bug that never reaches the real store look like it works.
  const buffers = new Map<string, string>();
  /*
   * A machine that looks alive without pretending to be this one.
   *
   * The numbers drift rather than sitting still, because the readout's whole
   * claim is that it is live: a preview showing one frozen reading would look
   * identical to the bug where polling has stopped.
   */
  let tick = 0;
  const system = {
    async status(): Promise<SystemReading> {
      tick += 1;
      const wave = (period: number) => (Math.sin(tick / period) + 1) / 2;
      return {
        cpu_pct: 8 + wave(3) * 34,
        mem_used: Math.round((7 + wave(5) * 2) * 1024 ** 3),
        mem_total: 16 * 1024 ** 3,
        disk_used: 223 * 1024 ** 3,
        disk_total: 465 * 1024 ** 3,
        net_rx_bps: Math.round(wave(2) * 2_400_000),
        net_tx_bps: Math.round(wave(4) * 180_000),
        uptime_s: 226_320 + tick * 2,
      };
    },
  };

  /*
   * The browser build cannot hash, diff or parse YAML — those live in Rust.
   *
   * It says so rather than returning something plausible. A made-up inbox is
   * an illustration; a made-up hash is a wrong answer to the exact question
   * the tool was opened to ask, and someone would eventually trust it.
   */
  const needsDesktop = async (): Promise<never> => {
    throw new Error("this tool runs in the desktop app");
  };

  const tools = {
    hash: needsDesktop,
    diff: needsDesktop,
    yamlToJson: needsDesktop,
    formatYaml: needsDesktop,
    machine: needsDesktop,
    processes: needsDesktop,
    endProcess: needsDesktop,
    resolve: needsDesktop,
    environment: needsDesktop,
    request: needsDesktop,
  };

  const scrollback: ScrollbackApi = {
    async load(key) {
      return buffers.get(key) ?? "";
    },
    async save(key, text) {
      buffers.set(key, text);
    },
    async forget(key) {
      buffers.delete(key);
    },
    async prune(keys) {
      for (const key of [...buffers.keys()]) {
        if (!keys.includes(key)) buffers.delete(key);
      }
    },
  };

  /*
   * The browser build has no window to dock a webview into, so this says so
   * rather than pretending. `available` is what the panel reads to decide
   * between a browser and an explanation.
   */
  const browser: BrowserApi = {
    available: false,
    async open() {
      throw new Error("the browser needs the desktop app");
    },
    async place() {},
    async close() {},
    async history() {},
  };

  /**
   * The browser build has no disk and no clipboard of its own to speak for, so
   * a capture is handed to the browser the way any download is. Copy uses the
   * async clipboard API where the browser allows it, and says so plainly where
   * it does not, rather than reporting a success that did not happen.
   */
  const capture: CaptureApi = {
    async save(png: Uint8Array<ArrayBuffer>) {
      const name = `jky-terminal-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      return name;
    },
    async copy(png: Uint8Array<ArrayBuffer>) {
      const item = new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) });
      await navigator.clipboard.write([item]);
    },
  };

  return {
    kind: "web",
    capture,
    system,
    tools,
    vault,
    settings,
    keys: keyboard,
    history,
    complete,
    remote,
    live,
    files,
    workspaces,
    lifecycle,
    pty,
    ai,
    store,
    games,
    apps,
    browser,
    scrollback,
    async listCommands() {
      return WEB_COMMANDS;
    },
    // The browser build has a real browser around it already.
    async openExternal(url: string) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
}
