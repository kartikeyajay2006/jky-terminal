import { afterEach, describe, expect, it } from "vitest";
import { getPlatform, hasTauriRuntime, __setPlatformForTests } from "./index";

describe("platform selection", () => {
  afterEach(() => {
    __setPlatformForTests(null);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("uses the web mock when no Tauri runtime is present", () => {
    __setPlatformForTests(null);
    expect(hasTauriRuntime()).toBe(false);
    expect(getPlatform().kind).toBe("web");
  });

  it("uses the real backend when the Tauri runtime is present", () => {
    // The regression this guards: the desktop app once shipped running the
    // browser mock, because selection depended on a build flag nothing set.
    // Keys went to an in-memory map instead of the keychain and the terminal
    // was a fake echo shell.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    __setPlatformForTests(null);
    expect(hasTauriRuntime()).toBe(true);
    expect(getPlatform().kind).toBe("tauri");
  });
});
