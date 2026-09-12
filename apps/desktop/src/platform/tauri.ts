import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppsApi,
  BrowserApi,
  CaptureApi,
  NewsArticle,
  GitHubBranch,
  GitHubCommit,
  GitHubConnectState,
  GitHubEntry,
  GitHubFile,
  GitHubNotification,
  GitHubDeviceStart,
  GitHubStatus,
  GmailFull,
  GmailMailbox,
  GmailStatus,
  Diff,
  EnvVar,
  Hashes,
  HttpResponse,
  Lookup,
  Machine,
  Listener,
  Proc,
  SystemApi,
  ToolsApi,
  SystemReading,
  GitHubSummary,
  NewsSource,
  Route,
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
  CompleteApi,
  Completions,
  FileEntry,
  FilePreview,
  FilesApi,
  Folder,
  LifecycleApi,
  LiveApi,
  LiveRun,
  LiveSource,
  WorkspaceApi,
  WorkspaceApplied,
  Workspaces,
  RemoteApi,
  RemoteHost,
  HistoryApi,
  HistoryHit,
  Keyboard,
  KeysApi,
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

  const keys: KeysApi = {
    async list() {
      return invoke<Keyboard>("keys_list");
    },
    async bind(action, chord) {
      return invoke<Keyboard>("keys_bind", { action, chord });
    },
    async reset(action) {
      return invoke<Keyboard>("keys_reset", { action });
    },
    async resetAll() {
      return invoke<Keyboard>("keys_reset_all");
    },
  };

  const history: HistoryApi = {
    async record(entry) {
      await invoke<void>("history_record", {
        command: entry.command,
        cwd: entry.cwd,
        code: entry.code,
        at: entry.at,
        session: entry.session,
        host: entry.host ?? null,
      });
    },
    async search(query) {
      return invoke<HistoryHit[]>("history_search", {
        text: query.text,
        session: query.session ?? null,
        cwd: query.cwd ?? null,
        failedOnly: query.failedOnly ?? false,
        limit: query.limit ?? 0,
        // The clock is the window's, so a search ranks against the moment
        // the person is looking rather than against whenever Rust last
        // happened to ask the operating system.
        now: Date.now(),
      });
    },
    async forget(command) {
      return invoke<number>("history_forget", { command });
    },
    async clear() {
      await invoke<void>("history_clear");
    },
  };

  const complete: CompleteApi = {
    async suggest(line, cursor, cwd, limit) {
      return invoke<Completions>("complete_suggest", { line, cursor, cwd, limit });
    },
  };

  const remote: RemoteApi = {
    async list() {
      return invoke<RemoteHost[]>("remote_list");
    },
    async save(host) {
      return invoke<RemoteHost[]>("remote_save", { host });
    },
    async forget(id) {
      return invoke<RemoteHost[]>("remote_forget", { id });
    },
    async spawn(id, cols, rows) {
      // The clock is the window's, for the same reason the history search's
      // is: it orders a list a person is looking at.
      return invoke<string>("remote_spawn", { id, cols, rows, at: Date.now() });
    },
  };

  const lifecycle: LifecycleApi = {
    async onCloseRequested(handler) {
      const window = getCurrentWindow();
      const stop = await window.onCloseRequested(async (event) => {
        // Always prevented first, then let through — a close cannot be
        // un-prevented once it has happened, and the handler may want to ask
        // a question before answering.
        event.preventDefault();
        if (handler()) await window.destroy();
      });
      return stop;
    },
    async close() {
      // `destroy` rather than `close`: `close` fires the request again and
      // would be caught by the very guard that is letting it through.
      await getCurrentWindow().destroy();
    },
  };

  const files: FilesApi = {
    async preview(root, path) {
      return invoke<FilePreview>("files_preview", { root, path });
    },
    async create(root, path, folder) {
      await invoke<void>("files_create", { root, path, folder });
    },
    async rename(root, from, to) {
      await invoke<void>("files_rename", { root, from, to });
    },
    async remove(root, path) {
      await invoke<void>("files_delete", { root, path });
    },
    async folders() {
      return invoke<Folder[]>("files_folders");
    },
    async openFolder(dir) {
      return invoke<Folder[]>("files_open_folder", { dir });
    },
    async closeFolder(dir) {
      return invoke<Folder[]>("files_close_folder", { dir });
    },
    async list(root, path) {
      return invoke<FileEntry[]>("files_list", { root, path });
    },
    async read(root, path) {
      return invoke<string>("files_read", { root, path });
    },
    async write(root, path, text) {
      await invoke<void>("files_write", { root, path, text });
    },
  };

  const workspaces: WorkspaceApi = {
    async list() {
      return invoke<Workspaces>("workspace_list");
    },
    async save(workspace) {
      return invoke<Workspaces>("workspace_save", { workspace });
    },
    async forget(id) {
      return invoke<Workspaces>("workspace_forget", { id });
    },
    async activate(id) {
      // The clock is the window's, as everywhere else: it orders a list a
      // person is looking at.
      return invoke<WorkspaceApplied>("workspace_activate", { id, at: Date.now() });
    },
    async leave() {
      return invoke<Workspaces>("workspace_leave");
    },
  };

  const live: LiveApi = {
    async sources() {
      return invoke<LiveSource[]>("live_sources");
    },
    async run(source) {
      return invoke<LiveRun>("live_run", { source });
    },
  };

  const pty: PtyApi = {
    async spawn(cols, rows, banner, accent) {
      return invoke<string>("pty_spawn", { cols, rows, banner, accent });
    },
    async shell() {
      return invoke<string>("pty_shell");
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
    askOnce: (provider, prompt) => invoke<string>("ai_ask_once", { provider, prompt }),
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

  const capture: CaptureApi = {
    // Sent as a plain array: Tauri's IPC serialises a Uint8Array to JSON as an
    // object keyed by index, which arrives in Rust as a map rather than bytes.
    save: (png) => invoke<string>("capture_save", { png: Array.from(png) }),
    copy: (png) => invoke<void>("capture_copy", { png: Array.from(png) }),
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
    github: {
      status: () => invoke<GitHubStatus>("apps_github_status"),
      setClientId: (id) => invoke<void>("apps_github_set_client_id", { id }),
      connectStart: () => invoke<GitHubDeviceStart>("apps_github_connect_start"),
      connectPoll: () => invoke<GitHubConnectState>("apps_github_connect_poll"),
      disconnect: () => invoke<void>("apps_github_disconnect"),
      summary: () => invoke<GitHubSummary>("apps_github_summary"),
      contents: (repo, path) => invoke<GitHubEntry[]>("apps_github_contents", { repo, path }),
      file: (repo, path) => invoke<GitHubFile>("apps_github_file", { repo, path }),
      commits: (repo) => invoke<GitHubCommit[]>("apps_github_commits", { repo }),
      branches: (repo) => invoke<GitHubBranch[]>("apps_github_branches", { repo }),
      notifications: () => invoke<GitHubNotification[]>("apps_github_notifications"),
    },
    gmail: {
      status: () => invoke<GmailStatus>("apps_gmail_status"),
      configure: (id, secret) => invoke<void>("apps_gmail_configure", { id, secret }),
      // Resolves only when the person has finished in their browser, which is
      // a wait of minutes rather than milliseconds. The panel says so.
      connect: () => invoke<string>("apps_gmail_connect"),
      disconnect: () => invoke<void>("apps_gmail_disconnect"),
      inbox: (count, query) => invoke<GmailMailbox>("apps_gmail_inbox", { count, query }),
      message: (id) => invoke<GmailFull>("apps_gmail_message", { id }),
    },
    route: (from, to) =>
      invoke<Route>("apps_route", {
        fromLatitude: from.latitude,
        fromLongitude: from.longitude,
        toLatitude: to.latitude,
        toLongitude: to.longitude,
      }),
  };

  const browser: BrowserApi = {
    available: true,
    open: (url, rect) => invoke<string>("browser_open", { url, rect }),
    place: (rect) => invoke<void>("browser_place", { rect }),
    close: () => invoke<void>("browser_close"),
    history: (step) => invoke<void>("browser_history", { step }),
  };

  const system: SystemApi = {
    status: () => invoke<SystemReading>("system_status"),
  };

  const tools: ToolsApi = {
    hash: (text) => invoke<Hashes>("tools_hash", { text }),
    diff: (before, after) => invoke<Diff>("tools_diff", { before, after }),
    yamlToJson: (text) => invoke<string>("tools_yaml_to_json", { text }),
    formatYaml: (text) => invoke<string>("tools_format_yaml", { text }),
    machine: () => invoke<Machine>("tools_machine"),
    processes: (sort, search) => invoke<Proc[]>("tools_processes", { sort, search }),
    endProcess: (pid) => invoke<boolean>("tools_end_process", { pid }),
    ports: (sort, search) => invoke<Listener[]>("tools_ports", { sort, search }),
    resolve: (host) => invoke<Lookup>("tools_resolve", { host }),
    environment: () => invoke<EnvVar[]>("tools_environment"),
    request: (method, url, headers, body) =>
      invoke<HttpResponse>("tools_request", { method, url, headers, body }),
  };

  const scrollback: ScrollbackApi = {
    load: (key) => invoke<string>("scrollback_load", { key }),
    save: (key, text) => invoke<void>("scrollback_save", { key, text }),
    forget: (key) => invoke<void>("scrollback_forget", { key }),
    prune: (keys) => invoke<void>("scrollback_prune", { keys }),
  };

  return {
    kind: "tauri",
    capture,
    system,
    tools,
    vault,
    settings,
    keys,
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
    listCommands: () => invoke<CommandSpec[]>("commands_list"),
    openExternal: (url) => invoke<void>("open_external", { url }),
  };
}
