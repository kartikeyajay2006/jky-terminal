use crate::Secret;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("no secret stored for '{0}'")]
    NotFound(String),

    #[error("secret store backend error: {0}")]
    Backend(String),

    #[error("invalid key format for provider '{0}'")]
    InvalidFormat(String),
}

/// Storage for secret material.
///
/// Implementations must never log, serialize, or otherwise emit stored values.
/// Note there is deliberately no bulk-export operation.
pub trait SecretStore: Send + Sync {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError>;

    /// Read a stored secret. This is crate-internal by convention: it must never
    /// be reachable from an IPC command. See `apps/desktop/src-tauri/tests/security.rs`.
    fn get(&self, key: &str) -> Result<Secret<String>, SecretError>;

    fn has(&self, key: &str) -> Result<bool, SecretError>;

    fn delete(&self, key: &str) -> Result<(), SecretError>;
}
