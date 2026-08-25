import { beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

describe("web platform mock", () => {
  let platform: Platform;

  beforeEach(() => {
    platform = createWebPlatform();
  });

  it("reports a provider as disconnected before any key is stored", async () => {
    const providers = await platform.vault.listProviders();
    expect(providers).toEqual([
      { id: "anthropic", displayName: "Anthropic", connected: false },
    ]);
  });

  it("marks a provider connected after storing a valid key", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    expect(await platform.vault.hasSecret("anthropic")).toBe(true);
  });

  it("rejects a malformed key the same way the Rust validator does", async () => {
    await expect(
      platform.vault.setSecret("anthropic", "not-a-key"),
    ).rejects.toThrow(/invalid key format/i);
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("rejects an unknown provider", async () => {
    await expect(
      platform.vault.setSecret("skynet", `sk-ant-api03-${"x".repeat(40)}`),
    ).rejects.toThrow(/unknown provider/i);
  });

  it("disconnects a provider after delete", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    await platform.vault.deleteSecret("anthropic");
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("exposes no way to read a stored secret back", () => {
    const surface = Object.keys(platform.vault);
    expect(surface).toEqual([
      "setSecret",
      "hasSecret",
      "deleteSecret",
      "listProviders",
    ]);
    expect(surface.join(" ")).not.toMatch(/get|read|reveal/i);
  });

  it("does not persist secrets to browser storage", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    expect(JSON.stringify(localStorage)).not.toContain("sk-ant");
    expect(JSON.stringify(sessionStorage)).not.toContain("sk-ant");
  });
});
