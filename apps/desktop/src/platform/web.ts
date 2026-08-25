import { PROVIDERS, findProvider, toStatus, validateKey } from "./catalogue";
import type { Platform, ProviderStatus, SettingsApi, VaultApi } from "./types";

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

  return { kind: "web", vault, settings };
}
