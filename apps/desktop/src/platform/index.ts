import { createTauriPlatform } from "./tauri";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

export type { Platform, ProviderStatus, VaultApi } from "./types";
export { createWebPlatform } from "./web";

let instance: Platform | null = null;

export function getPlatform(): Platform {
  if (!instance) {
    instance = __JKY_PLATFORM__ === "tauri" ? createTauriPlatform() : createWebPlatform();
  }
  return instance;
}

/** Test-only escape hatch for injecting a stub platform. */
export function __setPlatformForTests(p: Platform | null): void {
  instance = p;
}
