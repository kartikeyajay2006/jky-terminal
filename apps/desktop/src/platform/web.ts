import { PROVIDERS, findProvider, toStatus, validateKey } from "./catalogue";
import type {
  AiApi,
  Platform,
  ProviderStatus,
  PtyApi,
  SettingsApi,
  ToolRequest,
  VaultApi,
} from "./types";

/**
 * Development-only backend.
 *
 * Values live in closures and die with the tab. Deliberately NOT localStorage
 * or sessionStorage — the browser build must never write credentials to disk.
 */
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
    async spawn(_cols, _rows, _banner) {
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

  return { kind: "web", vault, settings, pty, ai };
}
