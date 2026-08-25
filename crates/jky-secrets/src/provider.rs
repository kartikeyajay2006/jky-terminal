use serde::{Deserialize, Serialize};

use crate::SecretError;

/// One selectable model offered by a provider.
///
/// These lists are curated starting points, not an authoritative catalogue —
/// providers ship new models constantly. The UI always accepts a custom model
/// id, so a model released after this build can still be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub note: &'static str,
}

const fn m(id: &'static str, label: &'static str, note: &'static str) -> ModelSpec {
    ModelSpec { id, label, note }
}

const ANTHROPIC_MODELS: &[ModelSpec] = &[
    m("claude-sonnet-5", "Claude Sonnet 5", "Balanced — recommended default"),
    m("claude-opus-5", "Claude Opus 5", "Most capable, slower and pricier"),
    m("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "Fastest and cheapest"),
];

const OPENAI_MODELS: &[ModelSpec] = &[
    m("gpt-4o", "GPT-4o", "General purpose"),
    m("gpt-4o-mini", "GPT-4o mini", "Fast and cheap"),
    m("o1", "o1", "Reasoning"),
    m("o3-mini", "o3-mini", "Reasoning, lower cost"),
];

const GOOGLE_MODELS: &[ModelSpec] = &[
    m("gemini-2.0-flash", "Gemini 2.0 Flash", "Fast, large context"),
    m("gemini-1.5-pro", "Gemini 1.5 Pro", "Most capable"),
    m("gemini-1.5-flash", "Gemini 1.5 Flash", "Cheapest"),
];

const MISTRAL_MODELS: &[ModelSpec] = &[
    m("mistral-large-latest", "Mistral Large", "Most capable"),
    m("mistral-small-latest", "Mistral Small", "Fast and cheap"),
    m("codestral-latest", "Codestral", "Code specialised"),
];

const GROQ_MODELS: &[ModelSpec] = &[
    m("llama-3.3-70b-versatile", "Llama 3.3 70B", "Best quality on Groq"),
    m("llama-3.1-8b-instant", "Llama 3.1 8B", "Fastest"),
];

const DEEPSEEK_MODELS: &[ModelSpec] = &[
    m("deepseek-chat", "DeepSeek Chat", "General purpose"),
    m("deepseek-reasoner", "DeepSeek Reasoner", "Reasoning"),
];

const XAI_MODELS: &[ModelSpec] = &[
    m("grok-2-latest", "Grok 2", "General purpose"),
    m("grok-beta", "Grok Beta", "Preview"),
];

const OPENROUTER_MODELS: &[ModelSpec] = &[
    m("anthropic/claude-sonnet-5", "Claude Sonnet 5", "via OpenRouter"),
    m("openai/gpt-4o", "GPT-4o", "via OpenRouter"),
    m("google/gemini-2.0-flash-001", "Gemini 2.0 Flash", "via OpenRouter"),
];

const OLLAMA_MODELS: &[ModelSpec] = &[
    m("llama3.2", "Llama 3.2", "Runs locally"),
    m("qwen2.5-coder", "Qwen 2.5 Coder", "Code specialised, local"),
    m("deepseek-r1", "DeepSeek R1", "Reasoning, local"),
];

/// An AI provider whose credential the vault can hold.
///
/// Adding a provider means adding a variant plus one arm in each `match` below.
/// Nothing outside this file needs to change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Anthropic,
    OpenAi,
    Google,
    Mistral,
    Groq,
    DeepSeek,
    XAi,
    OpenRouter,
    Ollama,
}

impl ProviderId {
    pub fn all() -> &'static [ProviderId] {
        use ProviderId::*;
        &[
            Anthropic, OpenAi, Google, Mistral, Groq, DeepSeek, XAi, OpenRouter, Ollama,
        ]
    }

    pub fn as_key(&self) -> &'static str {
        use ProviderId::*;
        match self {
            Anthropic => "anthropic",
            OpenAi => "openai",
            Google => "google",
            Mistral => "mistral",
            Groq => "groq",
            DeepSeek => "deepseek",
            XAi => "xai",
            OpenRouter => "openrouter",
            Ollama => "ollama",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Self::all().iter().copied().find(|p| p.as_key() == raw)
    }

    pub fn display_name(&self) -> &'static str {
        use ProviderId::*;
        match self {
            Anthropic => "Anthropic",
            OpenAi => "OpenAI",
            Google => "Google Gemini",
            Mistral => "Mistral AI",
            Groq => "Groq",
            DeepSeek => "DeepSeek",
            XAi => "xAI",
            OpenRouter => "OpenRouter",
            Ollama => "Ollama (local)",
        }
    }

    /// One line explaining what this provider is good for.
    pub fn tagline(&self) -> &'static str {
        use ProviderId::*;
        match self {
            Anthropic => "Claude models. Strongest at coding and agentic tool use.",
            OpenAi => "GPT and o-series reasoning models.",
            Google => "Gemini models with very large context windows.",
            Mistral => "Open-weight European models, strong price-performance.",
            Groq => "Open models served on custom silicon — extremely fast.",
            DeepSeek => "Low-cost chat and reasoning models.",
            XAi => "Grok models.",
            OpenRouter => "One key, hundreds of models routed across providers.",
            Ollama => "Runs models entirely on your own machine. No key, no network.",
        }
    }

    /// Where the user goes to obtain a key.
    pub fn console_url(&self) -> &'static str {
        use ProviderId::*;
        match self {
            Anthropic => "https://console.anthropic.com/settings/keys",
            OpenAi => "https://platform.openai.com/api-keys",
            Google => "https://aistudio.google.com/apikey",
            Mistral => "https://console.mistral.ai/api-keys",
            Groq => "https://console.groq.com/keys",
            DeepSeek => "https://platform.deepseek.com/api_keys",
            XAi => "https://console.x.ai",
            OpenRouter => "https://openrouter.ai/keys",
            Ollama => "http://localhost:11434",
        }
    }

    /// Whether a credential is needed at all. Local runtimes need none.
    pub fn requires_key(&self) -> bool {
        !matches!(self, ProviderId::Ollama)
    }

    /// Accepted key prefixes. Empty means the provider publishes no stable
    /// prefix, in which case only the length check applies.
    pub fn key_prefixes(&self) -> &'static [&'static str] {
        use ProviderId::*;
        match self {
            Anthropic => &["sk-ant-"],
            OpenAi => &["sk-"],
            Google => &["AIza"],
            Mistral => &[],
            Groq => &["gsk_"],
            DeepSeek => &["sk-"],
            XAi => &["xai-"],
            OpenRouter => &["sk-or-"],
            Ollama => &[],
        }
    }

    fn min_key_len(&self) -> usize {
        match self {
            ProviderId::Google => 35,
            _ => 20,
        }
    }

    pub fn models(&self) -> &'static [ModelSpec] {
        use ProviderId::*;
        match self {
            Anthropic => ANTHROPIC_MODELS,
            OpenAi => OPENAI_MODELS,
            Google => GOOGLE_MODELS,
            Mistral => MISTRAL_MODELS,
            Groq => GROQ_MODELS,
            DeepSeek => DEEPSEEK_MODELS,
            XAi => XAI_MODELS,
            OpenRouter => OPENROUTER_MODELS,
            Ollama => OLLAMA_MODELS,
        }
    }

    /// The model selected when the user has expressed no preference.
    pub fn default_model(&self) -> &'static str {
        self.models()[0].id
    }

    /// Cheap client-side shape check. This catches typos and wrong-vendor keys
    /// before they reach the keychain; it does not prove the key is live.
    ///
    /// Deliberately rejects surrounding whitespace instead of trimming, so the
    /// stored value is always exactly what the user was shown.
    ///
    /// The error is built from the provider name only. It never contains the
    /// rejected candidate, so it is safe to log and safe to show.
    pub fn validate(&self, candidate: &str) -> Result<(), SecretError> {
        let invalid = || SecretError::InvalidFormat(self.as_key().to_string());

        if !self.requires_key() {
            return Ok(());
        }

        if candidate.trim() != candidate {
            return Err(invalid());
        }

        if candidate.len() < self.min_key_len() {
            return Err(invalid());
        }

        let prefixes = self.key_prefixes();
        if !prefixes.is_empty() && !prefixes.iter().any(|p| candidate.starts_with(p)) {
            return Err(invalid());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_of(len: usize, prefix: &str) -> String {
        format!("{prefix}{}", "x".repeat(len.saturating_sub(prefix.len())))
    }

    #[test]
    fn every_provider_has_a_unique_storage_key() {
        let mut keys: Vec<&str> = ProviderId::all().iter().map(|p| p.as_key()).collect();
        let count = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), count, "two providers share a storage key");
    }

    #[test]
    fn every_provider_round_trips_through_parse() {
        for p in ProviderId::all() {
            assert_eq!(ProviderId::parse(p.as_key()), Some(*p), "{}", p.as_key());
        }
        assert_eq!(ProviderId::parse("nonsense"), None);
    }

    #[test]
    fn every_provider_offers_at_least_one_model() {
        for p in ProviderId::all() {
            assert!(!p.models().is_empty(), "{} has no models", p.as_key());
        }
    }

    #[test]
    fn every_providers_default_model_is_in_its_own_model_list() {
        for p in ProviderId::all() {
            let default = p.default_model();
            assert!(
                p.models().iter().any(|m| m.id == default),
                "{} default '{default}' is not in its model list",
                p.as_key()
            );
        }
    }

    #[test]
    fn accepts_a_well_formed_key_for_each_provider_that_needs_one() {
        for p in ProviderId::all() {
            if !p.requires_key() {
                continue;
            }
            let prefix = p.key_prefixes().first().copied().unwrap_or("");
            let candidate = key_of(60, prefix);
            assert!(
                p.validate(&candidate).is_ok(),
                "{} rejected its own well-formed key '{candidate}'",
                p.as_key()
            );
        }
    }

    #[test]
    fn anthropic_rejects_a_key_with_the_wrong_prefix() {
        let key = key_of(60, "sk-proj-");
        assert!(matches!(
            ProviderId::Anthropic.validate(&key),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn google_rejects_a_key_with_the_wrong_prefix() {
        let key = key_of(60, "sk-ant-");
        assert!(matches!(
            ProviderId::Google.validate(&key),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn a_provider_with_no_prefix_requirement_still_enforces_a_minimum_length() {
        assert!(ProviderId::Mistral.validate("short").is_err());
        assert!(ProviderId::Mistral.validate(&key_of(40, "")).is_ok());
    }

    #[test]
    fn a_local_provider_needs_no_key_and_accepts_an_empty_one() {
        assert!(!ProviderId::Ollama.requires_key());
        assert!(ProviderId::Ollama.validate("").is_ok());
    }

    #[test]
    fn rejects_whitespace_padded_input_rather_than_silently_trimming() {
        let key = format!("  {}  ", key_of(60, "sk-ant-"));
        assert!(ProviderId::Anthropic.validate(&key).is_err());
    }

    #[test]
    fn no_validation_error_ever_echoes_the_rejected_key() {
        for p in ProviderId::all() {
            let leaky = format!("WRONGPREFIX-LEAKCANARY-{}", "x".repeat(60));
            if let Err(e) = p.validate(&leaky) {
                assert!(
                    !format!("{e}").contains("LEAKCANARY"),
                    "{} echoed the rejected key: {e}",
                    p.as_key()
                );
            }
        }
    }

    #[test]
    fn model_ids_are_unique_within_each_provider() {
        for p in ProviderId::all() {
            let mut ids: Vec<&str> = p.models().iter().map(|m| m.id).collect();
            let count = ids.len();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), count, "{} lists a duplicate model id", p.as_key());
        }
    }

    #[test]
    fn every_provider_links_somewhere_a_user_can_get_a_key() {
        for p in ProviderId::all() {
            assert!(
                p.console_url().starts_with("https://") || p.console_url().starts_with("http://localhost"),
                "{} has an unusable console url: {}",
                p.as_key(),
                p.console_url()
            );
        }
    }
}
