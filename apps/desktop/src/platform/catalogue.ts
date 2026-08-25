import type { ModelOption, ProviderStatus } from "./types";

/**
 * Mirror of `ProviderId` in crates/jky-secrets/src/provider.rs.
 *
 * The desktop build never reads this — it gets the real catalogue over IPC.
 * It exists so the browser development build and the test suite behave like
 * the real backend, including its validation rules.
 */
export interface ProviderSpec {
  id: string;
  displayName: string;
  tagline: string;
  consoleUrl: string;
  requiresKey: boolean;
  keyPrefixes: string[];
  minKeyLength: number;
  models: ModelOption[];
}

const m = (id: string, label: string, note: string): ModelOption => ({ id, label, note });

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "anthropic",
    displayName: "Anthropic",
    tagline: "Claude models. Strongest at coding and agentic tool use.",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    requiresKey: true,
    keyPrefixes: ["sk-ant-"],
    minKeyLength: 20,
    models: [
      m("claude-sonnet-5", "Claude Sonnet 5", "Balanced — recommended default"),
      m("claude-opus-5", "Claude Opus 5", "Most capable, slower and pricier"),
      m("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "Fastest and cheapest"),
    ],
  },
  {
    id: "openai",
    displayName: "OpenAI",
    tagline: "GPT and o-series reasoning models.",
    consoleUrl: "https://platform.openai.com/api-keys",
    requiresKey: true,
    keyPrefixes: ["sk-"],
    minKeyLength: 20,
    models: [
      m("gpt-4o", "GPT-4o", "General purpose"),
      m("gpt-4o-mini", "GPT-4o mini", "Fast and cheap"),
      m("o1", "o1", "Reasoning"),
      m("o3-mini", "o3-mini", "Reasoning, lower cost"),
    ],
  },
  {
    id: "google",
    displayName: "Google Gemini",
    tagline: "Gemini models with very large context windows.",
    consoleUrl: "https://aistudio.google.com/apikey",
    requiresKey: true,
    keyPrefixes: ["AIza"],
    minKeyLength: 35,
    models: [
      m("gemini-2.0-flash", "Gemini 2.0 Flash", "Fast, large context"),
      m("gemini-1.5-pro", "Gemini 1.5 Pro", "Most capable"),
      m("gemini-1.5-flash", "Gemini 1.5 Flash", "Cheapest"),
    ],
  },
  {
    id: "mistral",
    displayName: "Mistral AI",
    tagline: "Open-weight European models, strong price-performance.",
    consoleUrl: "https://console.mistral.ai/api-keys",
    requiresKey: true,
    keyPrefixes: [],
    minKeyLength: 20,
    models: [
      m("mistral-large-latest", "Mistral Large", "Most capable"),
      m("mistral-small-latest", "Mistral Small", "Fast and cheap"),
      m("codestral-latest", "Codestral", "Code specialised"),
    ],
  },
  {
    id: "groq",
    displayName: "Groq",
    tagline: "Open models served on custom silicon — extremely fast.",
    consoleUrl: "https://console.groq.com/keys",
    requiresKey: true,
    keyPrefixes: ["gsk_"],
    minKeyLength: 20,
    models: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B", "Best quality on Groq"),
      m("llama-3.1-8b-instant", "Llama 3.1 8B", "Fastest"),
    ],
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    tagline: "Low-cost chat and reasoning models.",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    requiresKey: true,
    keyPrefixes: ["sk-"],
    minKeyLength: 20,
    models: [
      m("deepseek-chat", "DeepSeek Chat", "General purpose"),
      m("deepseek-reasoner", "DeepSeek Reasoner", "Reasoning"),
    ],
  },
  {
    id: "xai",
    displayName: "xAI",
    tagline: "Grok models.",
    consoleUrl: "https://console.x.ai",
    requiresKey: true,
    keyPrefixes: ["xai-"],
    minKeyLength: 20,
    models: [
      m("grok-2-latest", "Grok 2", "General purpose"),
      m("grok-beta", "Grok Beta", "Preview"),
    ],
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    tagline: "One key, hundreds of models routed across providers.",
    consoleUrl: "https://openrouter.ai/keys",
    requiresKey: true,
    keyPrefixes: ["sk-or-"],
    minKeyLength: 20,
    models: [
      m("anthropic/claude-sonnet-5", "Claude Sonnet 5", "via OpenRouter"),
      m("openai/gpt-4o", "GPT-4o", "via OpenRouter"),
      m("google/gemini-2.0-flash-001", "Gemini 2.0 Flash", "via OpenRouter"),
    ],
  },
  {
    id: "ollama",
    displayName: "Ollama (local)",
    tagline: "Runs models entirely on your own machine. No key, no network.",
    consoleUrl: "http://localhost:11434",
    requiresKey: false,
    keyPrefixes: [],
    minKeyLength: 0,
    models: [
      m("llama3.2", "Llama 3.2", "Runs locally"),
      m("qwen2.5-coder", "Qwen 2.5 Coder", "Code specialised, local"),
      m("deepseek-r1", "DeepSeek R1", "Reasoning, local"),
    ],
  },
];

export function findProvider(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Mirrors `ProviderId::validate`. Never echoes the candidate into the error. */
export function validateKey(spec: ProviderSpec, candidate: string): void {
  if (!spec.requiresKey) return;
  const invalid = () => {
    throw new Error(`invalid key format for provider '${spec.id}'`);
  };
  if (candidate.trim() !== candidate) invalid();
  if (candidate.length < spec.minKeyLength) invalid();
  if (spec.keyPrefixes.length > 0 && !spec.keyPrefixes.some((p) => candidate.startsWith(p))) {
    invalid();
  }
}

export function toStatus(
  spec: ProviderSpec,
  connected: boolean,
  selectedModel: string | null,
): ProviderStatus {
  return {
    id: spec.id,
    displayName: spec.displayName,
    tagline: spec.tagline,
    consoleUrl: spec.consoleUrl,
    requiresKey: spec.requiresKey,
    keyPrefixes: spec.keyPrefixes,
    connected,
    models: spec.models,
    defaultModel: spec.models[0].id,
    selectedModel,
  };
}
