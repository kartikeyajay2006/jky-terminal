import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AiApi,
  CommandSpec,
  ModelOption,
  Platform,
  ProviderStatus,
  PtyApi,
  SettingsApi,
  ToolRan,
  ToolRequest,
  VaultApi,
} from "./types";

/** Wire shape from Rust: serde emits snake_case. */
interface RawProviderStatus {
  id: string;
  display_name: string;
  tagline: string;
  console_url: string;
  requires_key: boolean;
  key_prefixes: string[];
  connected: boolean;
  models: ModelOption[];
  default_model: string;
  selected_model: string | null;
}

export function createTauriPlatform(): Platform {
  const vault: VaultApi = {
    async setSecret(provider, value) {
      await invoke<void>("vault_set_secret", { provider, value });
    },
    async hasSecret(provider) {
      return invoke<boolean>("vault_has_secret", { provider });
    },
    async deleteSecret(provider) {
      await invoke<void>("vault_delete_secret", { provider });
    },
    async listProviders(): Promise<ProviderStatus[]> {
      const raw = await invoke<RawProviderStatus[]>("vault_list_providers");
      return raw.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        tagline: r.tagline,
        consoleUrl: r.console_url,
        requiresKey: r.requires_key,
        keyPrefixes: r.key_prefixes,
        connected: r.connected,
        models: r.models,
        defaultModel: r.default_model,
        selectedModel: r.selected_model,
      }));
    },
  };

  const settings: SettingsApi = {
    async setSelectedModel(provider, model) {
      await invoke<void>("settings_set_selected_model", { provider, model });
    },
    async setActiveProvider(provider) {
      await invoke<void>("settings_set_active_provider", { provider });
    },
  };

  const pty: PtyApi = {
    async spawn(cols, rows, banner, accent) {
      return invoke<string>("pty_spawn", { cols, rows, banner, accent });
    },
    async write(id, data) {
      await invoke<void>("pty_write", { id, data });
    },
    async resize(id, cols, rows) {
      await invoke<void>("pty_resize", { id, cols, rows });
    },
    async kill(id) {
      await invoke<void>("pty_kill", { id });
    },
    async onData(id, handler) {
      return listen<{ id: string; chunk: string }>(`pty:data:${id}`, (e) =>
        handler(e.payload.chunk),
      );
    },
    async attach(id) {
      await invoke<void>("pty_attach", { id });
    },
  };

  const ai: AiApi = {
    async send(provider, conversation) {
      await invoke<void>("ai_send", { provider, conversation });
    },
    async approveTool(id) {
      await invoke<void>("ai_approve_tool", { callId: id });
    },
    async rejectTool(id) {
      await invoke<void>("ai_reject_tool", { callId: id });
    },
    onDelta: (h) => listen<string>("ai:delta", (e) => h(e.payload)),
    onToolRequest: (h) => listen<ToolRequest>("ai:tool_request", (e) => h(e.payload)),
    onToolRan: (h) => listen<ToolRan>("ai:tool_ran", (e) => h(e.payload)),
    onDone: (h) => listen<string>("ai:done", (e) => h(e.payload)),
    onError: (h) => listen<string>("ai:error", (e) => h(e.payload)),
  };

  return {
    kind: "tauri",
    vault,
    settings,
    pty,
    ai,
    listCommands: () => invoke<CommandSpec[]>("commands_list"),
  };
}
