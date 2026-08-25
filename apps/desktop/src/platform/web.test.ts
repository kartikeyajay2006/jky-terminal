import { beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";
import { PROVIDERS } from "./catalogue";
import type { Platform } from "./types";

const ANTHROPIC_KEY = `sk-ant-api03-${"x".repeat(40)}`;

describe("web platform mock", () => {
  let platform: Platform;

  beforeEach(() => {
    platform = createWebPlatform();
  });

  it("lists the whole provider catalogue", async () => {
    const providers = await platform.vault.listProviders();
    expect(providers).toHaveLength(PROVIDERS.length);
    expect(providers.map((p) => p.id)).toContain("anthropic");
    expect(providers.map((p) => p.id)).toContain("openai");
    expect(providers.map((p) => p.id)).toContain("google");
  });

  it("reports every provider as holding no key before anything is stored", async () => {
    const providers = await platform.vault.listProviders();
    expect(providers.every((p) => !p.connected)).toBe(true);
  });

  it("marks only the provider whose key was stored", async () => {
    await platform.vault.setSecret("anthropic", ANTHROPIC_KEY);
    const providers = await platform.vault.listProviders();
    expect(providers.find((p) => p.id === "anthropic")!.connected).toBe(true);
    expect(providers.find((p) => p.id === "openai")!.connected).toBe(false);
  });

  it("rejects a malformed key the same way the Rust validator does", async () => {
    await expect(platform.vault.setSecret("anthropic", "not-a-key")).rejects.toThrow(
      /invalid key format/i,
    );
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("rejects a key meant for a different provider", async () => {
    await expect(platform.vault.setSecret("google", ANTHROPIC_KEY)).rejects.toThrow(
      /invalid key format/i,
    );
  });

  it("rejects an unknown provider", async () => {
    await expect(platform.vault.setSecret("skynet", ANTHROPIC_KEY)).rejects.toThrow(
      /unknown provider/i,
    );
  });

  it("accepts an empty key for a provider that needs none", async () => {
    await expect(platform.vault.setSecret("ollama", "")).resolves.toBeUndefined();
  });

  it("disconnects a provider after delete", async () => {
    await platform.vault.setSecret("anthropic", ANTHROPIC_KEY);
    await platform.vault.deleteSecret("anthropic");
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("remembers a selected model per provider", async () => {
    await platform.settings.setSelectedModel("anthropic", "claude-opus-5");
    await platform.settings.setSelectedModel("openai", "gpt-4o-mini");
    const providers = await platform.vault.listProviders();
    expect(providers.find((p) => p.id === "anthropic")!.selectedModel).toBe("claude-opus-5");
    expect(providers.find((p) => p.id === "openai")!.selectedModel).toBe("gpt-4o-mini");
    expect(providers.find((p) => p.id === "groq")!.selectedModel).toBeNull();
  });

  it("exposes no way to read a stored secret back", () => {
    const surface = Object.keys(platform.vault);
    expect(surface).toEqual(["setSecret", "hasSecret", "deleteSecret", "listProviders"]);
    expect(surface.join(" ")).not.toMatch(/get|read|reveal/i);
  });

  it("does not persist secrets to browser storage", async () => {
    await platform.vault.setSecret("anthropic", ANTHROPIC_KEY);
    expect(JSON.stringify(localStorage)).not.toContain("sk-ant");
    expect(JSON.stringify(sessionStorage)).not.toContain("sk-ant");
  });
});
