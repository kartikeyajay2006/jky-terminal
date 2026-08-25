import { invoke } from "@tauri-apps/api/core";
import type { Platform, ProviderStatus, VaultApi } from "./types";

interface RawProviderStatus {
  id: string;
  display_name: string;
  connected: boolean;
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
        connected: r.connected,
      }));
    },
  };

  return { kind: "tauri", vault };
}
