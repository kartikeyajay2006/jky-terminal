import { PROVIDERS, findProvider, toStatus, validateKey } from "./catalogue";
import type {
  AiApi,
  AuditEvent,
  CollectionApi,
  CommandSpec,
  Event,
  Note,
  Platform,
  ProviderStatus,
  PtyApi,
  Reminder,
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

  return {
    kind: "web",
    vault,
    settings,
    pty,
    ai,
    store,
    async listCommands() {
      return WEB_COMMANDS;
    },
    async readAudit(): Promise<AuditEvent[]> {
      // The browser build has no backend to have recorded anything.
      return [];
    },
  };
}
