export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  tagline: string;
  consoleUrl: string;
  /** Local runtimes need no credential. */
  requiresKey: boolean;
  /** Accepted key prefixes, used to show the expected shape. May be empty. */
  keyPrefixes: string[];
  connected: boolean;
  models: ModelOption[];
  defaultModel: string;
  /** The user's explicit choice, if they have made one. */
  selectedModel: string | null;
}

/**
 * Every native capability the UI is allowed to reach.
 *
 * Note what is absent: there is no `getSecret`. The frontend can store a
 * secret, ask whether one exists, and delete it — never read it back. This
 * mirrors the Rust IPC surface, which has no getter either.
 */
export interface VaultApi {
  setSecret(provider: string, value: string): Promise<void>;
  hasSecret(provider: string): Promise<boolean>;
  deleteSecret(provider: string): Promise<void>;
  listProviders(): Promise<ProviderStatus[]>;
}

export interface SettingsApi {
  setSelectedModel(provider: string, model: string): Promise<void>;
  setActiveProvider(provider: string): Promise<void>;
}

export interface PtyApi {
  /** `banner` is stored so the `jky-terminal` shell command can reprint it. */
  spawn(cols: number, rows: number, banner: string): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  /** Subscribe to this session's output. Resolves to an unsubscribe function. */
  onData(id: string, handler: (chunk: string) => void): Promise<() => void>;
  /**
   * Start streaming output. Call only after `onData` has resolved: the shell
   * prints its prompt the instant it starts, and attaching first would emit
   * that prompt before anything was listening.
   */
  attach(id: string): Promise<void>;
}

export interface Platform {
  readonly kind: "web" | "tauri";
  readonly vault: VaultApi;
  readonly settings: SettingsApi;
  readonly pty: PtyApi;
}
