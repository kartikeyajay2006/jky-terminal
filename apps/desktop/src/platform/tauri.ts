import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppsApi,
  NewsArticle,
  NewsSource,
  Place,
  WeatherReport,
  AiApi,
  CollectionApi,
  CommandSpec,
  Event,
  GameScore,
  GamesApi,
  ModelOption,
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
    async cancel() {
      await invoke<void>("ai_cancel");
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

  /**
   * One collection over three commands.
   *
   * The command names are passed in rather than derived, so a typo is a
   * compile-time-visible literal in one place instead of a string built at
   * runtime that fails only when the user clicks something.
   */
  function collection<T>(
    listCmd: string,
    saveCmd: string,
    deleteCmd: string,
  ): CollectionApi<T> {
    return {
      list: () => invoke<T[]>(listCmd),
      save: (record) => invoke<T[]>(saveCmd, { record }),
      remove: (id) => invoke<T[]>(deleteCmd, { id }),
    };
  }

  const store: StoreApi = {
    notes: collection<Note>("store_list_notes", "store_save_note", "store_delete_note"),
    todos: collection<Todo>("store_list_todos", "store_save_todo", "store_delete_todo"),
    events: collection<Event>("store_list_events", "store_save_event", "store_delete_event"),
    reminders: collection<Reminder>(
      "store_list_reminders",
      "store_save_reminder",
      "store_delete_reminder",
    ),
  };

  const games: GamesApi = {
    publishScores: (scores: GameScore[]) =>
      invoke<void>("games_publish_scores", { scores }),
  };

  const apps: AppsApi = {
    weather: (latitude, longitude) =>
      invoke<WeatherReport>("apps_weather", { latitude, longitude }),
    searchPlaces: (query) => invoke<Place[]>("apps_place_search", { query }),
    news: (source, limit) => invoke<NewsArticle[]>("apps_news", { source, limit }),
    newsSources: () => invoke<NewsSource[]>("apps_news_sources"),
    locate: () => invoke<Place>("apps_locate"),
  };

  const scrollback: ScrollbackApi = {
    load: (key) => invoke<string>("scrollback_load", { key }),
    save: (key, text) => invoke<void>("scrollback_save", { key, text }),
    forget: (key) => invoke<void>("scrollback_forget", { key }),
    prune: (keys) => invoke<void>("scrollback_prune", { keys }),
  };

  return {
    kind: "tauri",
    vault,
    settings,
    pty,
    ai,
    store,
    games,
    apps,
    scrollback,
    listCommands: () => invoke<CommandSpec[]>("commands_list"),
    openExternal: (url) => invoke<void>("open_external", { url }),
  };
}
