import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { ProviderVault } from "./ProviderVault";

const ANTHROPIC_KEY = `sk-ant-api03-${"x".repeat(40)}`;
const OPENAI_KEY = `sk-${"y".repeat(48)}`;

async function open(name: RegExp) {
  const user = userEvent.setup();
  const row = await screen.findByRole("button", { name });
  await user.click(row);
  return user;
}

describe("ProviderVault", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  it("lists every supported provider, not just Anthropic", async () => {
    render(<ProviderVault />);
    for (const name of [
      /Anthropic/,
      /OpenAI/,
      /Google Gemini/,
      /Mistral AI/,
      /Groq/,
      /DeepSeek/,
      /xAI/,
      /OpenRouter/,
      /Ollama/,
    ]) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("starts with no keys added", async () => {
    render(<ProviderVault />);
    expect(await screen.findByLabelText(/0 of 8 keys added/i)).toBeInTheDocument();
  });

  it("stores a key for a provider and reports it connected", async () => {
    render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.type(await screen.findByLabelText(/anthropic api key/i), ANTHROPIC_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(await screen.findByLabelText(/1 of 8 keys added/i)).toBeInTheDocument();
  });

  it("connecting one provider leaves the others untouched", async () => {
    render(<ProviderVault />);
    const user = await open(/OpenAI/);

    await user.type(await screen.findByLabelText(/openai api key/i), OPENAI_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await screen.findByLabelText(/1 of 8 keys added/i);

    const anthropicRow = await screen.findByRole("button", { name: /Anthropic/ });
    expect(within(anthropicRow).getByText(/no key/i)).toBeInTheDocument();
  });

  it("replaces the key input with a sealed notice once a key is stored", async () => {
    render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.type(await screen.findByLabelText(/anthropic api key/i), ANTHROPIC_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    // The input does not merely disable — it is gone. There is nothing to read back.
    await waitFor(() =>
      expect(screen.queryByLabelText(/anthropic api key/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/sealed in your keychain/i)).toBeInTheDocument();
  });

  it("uses a password input so a key is never shown on screen", async () => {
    render(<ProviderVault />);
    await open(/Anthropic/);
    expect(await screen.findByLabelText(/anthropic api key/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("rejects a key meant for a different provider", async () => {
    render(<ProviderVault />);
    const user = await open(/Google Gemini/);

    await user.type(await screen.findByLabelText(/google gemini api key/i), ANTHROPIC_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid key format/i);
  });

  it("never echoes a rejected key back into the error message", async () => {
    render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.type(await screen.findByLabelText(/anthropic api key/i), "sk-bad-CANARY12345");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toContain("CANARY12345");
  });

  it("offers the provider's own models and shows its default", async () => {
    render(<ProviderVault />);
    await open(/Anthropic/);

    const select = await screen.findByLabelText(/^model$/i);
    expect(select).toHaveValue("claude-sonnet-5");
    expect(within(select as HTMLSelectElement).getByText(/Claude Opus 5/)).toBeInTheDocument();
    expect(within(select as HTMLSelectElement).getByText(/Claude Haiku/)).toBeInTheDocument();
  });

  it("does not offer one provider's models under another", async () => {
    render(<ProviderVault />);
    await open(/Groq/);

    const select = await screen.findByLabelText(/^model$/i);
    expect(within(select as HTMLSelectElement).queryByText(/Claude/)).not.toBeInTheDocument();
    expect(within(select as HTMLSelectElement).getByText(/Llama 3.3 70B/)).toBeInTheDocument();
  });

  it("remembers a chosen model", async () => {
    render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.selectOptions(await screen.findByLabelText(/^model$/i), "claude-opus-5");
    await waitFor(() =>
      expect(screen.getByLabelText(/^model$/i)).toHaveValue("claude-opus-5"),
    );
  });

  it("accepts a custom model id so models newer than this build still work", async () => {
    render(<ProviderVault />);
    const user = await open(/OpenAI/);

    await user.type(screen.getByPlaceholderText(/any model id/i), "gpt-6-unreleased");
    await user.click(screen.getByRole("button", { name: /^use$/i }));

    const row = await screen.findByRole("button", { name: /OpenAI/ });
    await waitFor(() =>
      expect(within(row).getByText(/gpt-6-unreleased/)).toBeInTheDocument(),
    );
  });

  it("asks for no key at all for a local runtime", async () => {
    render(<ProviderVault />);
    await open(/Ollama/);

    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/^model$/i)).toBeInTheDocument();
  });

  it("disconnects a provider and returns it to the no-key state", async () => {
    render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.type(await screen.findByLabelText(/anthropic api key/i), ANTHROPIC_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await screen.findByLabelText(/1 of 8 keys added/i);

    await user.click(screen.getByRole("button", { name: /disconnect anthropic/i }));
    expect(await screen.findByLabelText(/0 of 8 keys added/i)).toBeInTheDocument();
  });

  it("links to where the key can be obtained", async () => {
    render(<ProviderVault />);
    await open(/Anthropic/);

    const link = await screen.findByRole("link", { name: /console\.anthropic\.com/ });
    expect(link).toHaveAttribute("href", "https://console.anthropic.com/settings/keys");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("never renders stored key material anywhere in the tree", async () => {
    const { container } = render(<ProviderVault />);
    const user = await open(/Anthropic/);

    await user.type(await screen.findByLabelText(/anthropic api key/i), ANTHROPIC_KEY);
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await screen.findByLabelText(/1 of 8 keys added/i);

    expect(container.innerHTML).not.toContain(ANTHROPIC_KEY);
  });
});
