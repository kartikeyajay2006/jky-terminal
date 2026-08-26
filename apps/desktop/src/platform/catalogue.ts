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
      m("claude-opus-5", "Claude Opus 5", "Most capable — recommended default"),
      m("claude-sonnet-5", "Claude Sonnet 5", "Balanced cost and capability"),
      m("claude-haiku-4-5", "Claude Haiku 4.5", "Fastest and cheapest"),
      m("claude-fable-5", "Claude Fable 5", "Deepest reasoning, highest cost"),
      m("claude-opus-4-8", "Claude Opus 4.8", "Previous Opus generation"),
      m("claude-opus-4-7", "Claude Opus 4.7", "Previous Opus generation"),
      m("claude-opus-4-6", "Claude Opus 4.6", "Older Opus"),
      m("claude-sonnet-4-6", "Claude Sonnet 4.6", "Older Sonnet"),
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
      m("gpt-4o-mini", "GPT-4o mini", "Cheapest — good for trying things out"),
      m("gpt-4o", "GPT-4o", "General purpose"),
      m("gpt-4.1", "GPT-4.1", "Strong at long context"),
      m("gpt-4.1-mini", "GPT-4.1 mini", "Cheaper 4.1"),
      m("gpt-4.1-nano", "GPT-4.1 nano", "Cheapest 4.1"),
      m("o3", "o3", "Reasoning"),
      m("o3-mini", "o3-mini", "Reasoning, lower cost"),
      m("o4-mini", "o4-mini", "Newer small reasoning model"),
      m("o1", "o1", "Earlier reasoning model"),
      m("gpt-4-turbo", "GPT-4 Turbo", "Legacy"),
      m("gpt-3.5-turbo", "GPT-3.5 Turbo", "Legacy, very cheap"),
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
      m("gemini-2.0-flash-lite", "Gemini 2.0 Flash Lite", "Cheapest"),
      m("gemini-2.5-flash", "Gemini 2.5 Flash", "Newer fast model"),
      m("gemini-2.5-pro", "Gemini 2.5 Pro", "Most capable"),
      m("gemini-1.5-pro", "Gemini 1.5 Pro", "Previous generation, 2M context"),
      m("gemini-1.5-flash", "Gemini 1.5 Flash", "Previous generation, fast"),
      m("gemini-1.5-flash-8b", "Gemini 1.5 Flash 8B", "Smallest"),
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
      m("ministral-8b-latest", "Ministral 8B", "Small and fast"),
      m("ministral-3b-latest", "Ministral 3B", "Smallest"),
      m("pixtral-large-latest", "Pixtral Large", "Vision"),
      m("open-mistral-nemo", "Mistral Nemo", "Open weights"),
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
      m("deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill 70B", "Reasoning"),
      m("gemma2-9b-it", "Gemma 2 9B", "Small and quick"),
      m("mixtral-8x7b-32768", "Mixtral 8x7B", "Mixture of experts"),
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
      m("grok-2-vision-1212", "Grok 2 Vision", "Images"),
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
      m("anthropic/claude-opus-5", "Claude Opus 5", "via OpenRouter"),
      m("openai/gpt-4o", "GPT-4o", "via OpenRouter"),
      m("openai/gpt-4o-mini", "GPT-4o mini", "via OpenRouter"),
      m("google/gemini-2.0-flash-001", "Gemini 2.0 Flash", "via OpenRouter"),
      m("meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B", "via OpenRouter"),
      m("deepseek/deepseek-chat", "DeepSeek Chat", "via OpenRouter"),
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
      m("llama3.3", "Llama 3.3", "Larger, runs locally"),
      m("qwen2.5-coder", "Qwen 2.5 Coder", "Code specialised, local"),
      m("deepseek-r1", "DeepSeek R1", "Reasoning, local"),
      m("mistral", "Mistral 7B", "Small and quick, local"),
      m("phi4", "Phi 4", "Very small, local"),
      m("gemma2", "Gemma 2", "Local"),
      m("codellama", "Code Llama", "Code specialised, local"),
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
