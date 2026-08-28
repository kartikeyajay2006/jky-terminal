import { createTauriPlatform } from "./tauri";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";
export { EVENT_COLOURS } from "./types";

export type {
  AiApi,
  AiMessage,
  CollectionApi,
  CommandSpec,
  Event,
  EventColour,
  Note,
  Platform,
  ProviderStatus,
  PtyApi,
  Reminder,
  SettingsApi,
  StoreApi,
  Todo,
  ToolRan,
  ToolRequest,
  VaultApi,
} from "./types";
export { createWebPlatform } from "./web";

let instance: Platform | null = null;

/**
 * Detect the real backend at runtime.
 *
 * This was previously a build-time flag, and nothing ever set it — so the
 * desktop app silently ran the browser mock: keys went to an in-memory map
 * instead of the OS keychain, and the terminal was a fake echo shell with no
 * working backspace. A build flag is only as good as the one place that
 * remembers to set it.
 *
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview before any app code
 * runs, so its presence is the authoritative answer and cannot drift.
 */
export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getPlatform(): Platform {
  if (!instance) {
    instance = hasTauriRuntime() ? createTauriPlatform() : createWebPlatform();
  }
  return instance;
}

/** Test-only escape hatch for injecting a stub platform. */
export function __setPlatformForTests(p: Platform | null): void {
  instance = p;
}
