export interface ProviderStatus {
  id: string;
  displayName: string;
  connected: boolean;
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

export interface Platform {
  readonly kind: "web" | "tauri";
  readonly vault: VaultApi;
}
