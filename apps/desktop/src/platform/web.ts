import { PROVIDERS, findProvider, toStatus, validateKey } from "./catalogue";
import type {
  AppsApi,
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
      "One of dashboard, terminal, assistant, games or settings. A second word opens a panel inside it, so jky open dashboard calendar goes straight there.",
  },
  {
    names: ["jky banner"],
    usage: "jky banner",
    summary: "Print the banner",
    detail:
      "The same output as jky-terminal, reachable through the jky command for consistency.",
  },
];

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

  return {
    kind: "web",
    vault,
    settings,
    pty,
    ai,
    store,
    games,
    apps,
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
