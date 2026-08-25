import { invoke } from "@tauri-apps/api/core";
import type { ModelOption, Platform, ProviderStatus, SettingsApi, VaultApi } from "./types";

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

  return { kind: "tauri", vault, settings };
}
