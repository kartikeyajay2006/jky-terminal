use std::fmt;
use zeroize::Zeroize;

/// A value that must never appear in logs, traces, or error messages.
///
/// `Debug` and `Display` render a fixed placeholder. The inner value is
/// zeroized on drop. Read it only via [`Secret::expose`], and keep the
/// exposed reference's lifetime as short as possible.
pub struct Secret<T: Zeroize>(T);

impl<T: Zeroize> Secret<T> {
    pub fn new(value: T) -> Self {
        Self(value)
    }

    /// Read the wrapped value. Every call site is a place a secret can escape,
    /// so keep them few and keep them short.
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T: Zeroize> fmt::Debug for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl<T: Zeroize> fmt::Display for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl<T: Zeroize> Drop for Secret<T> {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The pragma must sit on the matched line itself — the CI grep filters
    // line by line, so a marker on the line above would not be seen.
    const SENSITIVE: &str = "sk-ant-api03-DO-NOT-LEAK-ME"; // pragma: allowlist secret

    #[test]
    fn debug_never_renders_the_value() {
        let s = Secret::new(SENSITIVE.to_string());
        let rendered = format!("{s:?}");
        assert!(
            !rendered.contains("sk-ant"),
            "Debug leaked the secret: {rendered}"
        );
        assert_eq!(rendered, "Secret([redacted])");
    }

    #[test]
    fn display_never_renders_the_value() {
        let s = Secret::new(SENSITIVE.to_string());
        let rendered = format!("{s}");
        assert!(!rendered.contains("sk-ant"), "Display leaked: {rendered}");
        assert_eq!(rendered, "[redacted]");
    }

    #[test]
    fn expose_returns_the_real_value() {
        let s = Secret::new(SENSITIVE.to_string());
        assert_eq!(s.expose(), SENSITIVE);
    }

    #[test]
    fn nested_in_a_struct_the_derived_debug_still_redacts() {
        #[derive(Debug)]
        #[allow(dead_code)]
        struct Config {
            name: String,
            api_key: Secret<String>,
        }
        let c = Config {
            name: "anthropic".into(),
            api_key: Secret::new(SENSITIVE.to_string()),
        };
        let rendered = format!("{c:?}");
        assert!(
            !rendered.contains("sk-ant"),
            "derived Debug leaked through the wrapper: {rendered}"
        );
        assert!(rendered.contains("anthropic"), "non-secret fields should still render");
    }
}
