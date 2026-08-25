use serde::{Deserialize, Serialize};

use crate::SecretError;

/// An AI provider whose credential the vault can hold.
///
/// v0.1 ships Anthropic only. Adding a provider means adding a variant here
/// plus its validation rule — nothing else changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Anthropic,
}

impl ProviderId {
    pub fn as_key(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "anthropic",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "anthropic" => Some(ProviderId::Anthropic),
            _ => None,
        }
    }

    pub fn all() -> &'static [ProviderId] {
        &[ProviderId::Anthropic]
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "Anthropic",
        }
    }

    /// Cheap client-side shape check. This catches typos and wrong-vendor keys
    /// before they reach the keychain; it does not prove the key is live.
    ///
    /// Deliberately rejects surrounding whitespace instead of trimming, so the
    /// stored value is always exactly what the user was shown.
    pub fn validate(&self, candidate: &str) -> Result<(), SecretError> {
        let invalid = || SecretError::InvalidFormat(self.as_key().to_string());

        if candidate.trim() != candidate {
            return Err(invalid());
        }

        match self {
            ProviderId::Anthropic => {
                if !candidate.starts_with("sk-ant-") || candidate.len() < 40 {
                    return Err(invalid());
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_key_maps_to_a_stable_storage_key() {
        assert_eq!(ProviderId::Anthropic.as_key(), "anthropic");
    }

    #[test]
    fn parses_from_its_storage_key() {
        assert_eq!(ProviderId::parse("anthropic"), Some(ProviderId::Anthropic));
        assert_eq!(ProviderId::parse("nonsense"), None);
    }

    #[test]
    fn accepts_a_well_formed_anthropic_key() {
        let key = format!("sk-ant-api03-{}", "x".repeat(40));
        assert!(ProviderId::Anthropic.validate(&key).is_ok());
    }

    #[test]
    fn rejects_a_key_with_the_wrong_prefix() {
        let key = format!("sk-proj-{}", "x".repeat(40));
        assert!(matches!(
            ProviderId::Anthropic.validate(&key),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_a_key_that_is_too_short_to_be_real() {
        assert!(matches!(
            ProviderId::Anthropic.validate("sk-ant-"),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_whitespace_padded_input_rather_than_silently_trimming() {
        let key = format!("  sk-ant-api03-{}  ", "x".repeat(40));
        assert!(ProviderId::Anthropic.validate(&key).is_err());
    }

    #[test]
    fn validation_error_does_not_echo_the_rejected_key() {
        let key = format!("sk-proj-SECRETVALUE{}", "x".repeat(40));
        let err = ProviderId::Anthropic.validate(&key).unwrap_err();
        assert!(
            !format!("{err}").contains("SECRETVALUE"),
            "validation error echoed the key back: {err}"
        );
    }
}
