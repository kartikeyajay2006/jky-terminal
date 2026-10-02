//! Finding secrets in text before it is kept or sent anywhere.
//!
//! Commands, scrollback and assistant context are exactly where tokens end
//! up: `export GITHUB_TOKEN=…`, a `curl -H "Authorization: Bearer …"`, a
//! `.env` file the assistant was asked to read. This crate recognises the
//! shapes those secrets have and replaces each with a label saying what was
//! removed, so the text stays readable and the secret does not survive.
//!
//! It recognises **shapes**, not meaning. A secret with no recognisable
//! shape — a password typed as a bare word — is not found, and the docs say
//! so. What it does find, it finds without ever logging or returning the
//! value: a [`Finding`] names a kind and a position, never the secret.

/// One secret found in a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// What it looked like: `anthropic-key`, `github-token`, `password`, …
    pub kind: &'static str,
    /// Byte range of the secret value itself in the original text.
    pub start: usize,
    pub end: usize,
}

/// A text with its secrets replaced, and what was replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redacted {
    pub text: String,
    /// The kind of each secret removed, in the order they appeared.
    pub removed: Vec<&'static str>,
}

use std::sync::LazyLock;

use regex::Regex;

struct Rule {
    kind: &'static str,
    pattern: Regex,
    /// The capture group holding the secret itself; 0 is the whole match.
    value: usize,
    /// For the generic rules, a second look at the value to keep the obvious
    /// non-secrets: a number, a `$VARIABLE`, a placeholder.
    plausible: fn(&str) -> bool,
}

fn always(_: &str) -> bool {
    true
}

/// A value that looks like it could be a secret rather than a setting.
fn looks_secret(value: &str) -> bool {
    let v = value.trim_matches(|c| c == '"' || c == '\'');
    v.len() >= 6
        && !v.chars().all(|c| c.is_ascii_digit())
        && !v.starts_with(['$', '{', '<', '%'])
        && !matches!(v.to_ascii_lowercase().as_str(), "true" | "false" | "null" | "none" | "changeme" | "redacted")
}

/// Rules in priority order: when two find the same secret, the earlier,
/// more specific one names it.
static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let rule = |kind, pattern: &str, value, plausible| Rule {
        kind,
        pattern: Regex::new(pattern).expect("a valid redaction pattern"),
        value,
        plausible,
    };
    vec![
        rule("private-key", r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\z)", 0, always),
        rule("anthropic-key", r"\bsk-ant-[A-Za-z0-9_\-]{20,}", 0, always),
        rule("openrouter-key", r"\bsk-or-[A-Za-z0-9_\-]{20,}", 0, always),
        rule("openai-key", r"\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}|\bsk-[A-Za-z0-9]{32,}\b", 0, always),
        rule("github-token", r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})", 0, always),
        rule("aws-access-key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", 0, always),
        rule("google-key", r"\bAIza[0-9A-Za-z_\-]{35}", 0, always),
        rule("slack-token", r"\bxox[abposr]-[A-Za-z0-9\-]{10,}", 0, always),
        rule("stripe-key", r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", 0, always),
        rule("groq-key", r"\bgsk_[A-Za-z0-9]{20,}", 0, always),
        rule("xai-key", r"\bxai-[A-Za-z0-9]{20,}", 0, always),
        rule("jwt", r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}", 0, always),
        rule(
            "credential",
            r"(?i)((?:authorization|proxy-authorization)\s*:\s*(?:bearer|token|basic)\s+)([A-Za-z0-9._~+/=\-]{12,})",
            2,
            always,
        ),
        rule("credential", r"(?i)((?:x-api-key|api-key|x-auth-token)\s*:\s*)([A-Za-z0-9._~+/=\-]{12,})", 2, always),
        rule("password", r"\b([a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@]+:)([^@\s/]+)@", 2, always),
        rule(
            "secret",
            r#"(?i)(--(?:password|passwd|token|api-key|apikey|secret|access-token|auth-token)(?:=|\s+))("[^"]+"|'[^']+'|[^\s"']{4,})"#,
            2,
            looks_secret,
        ),
        rule(
            "secret",
            r#"(?i)\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api_?key|access_?key|private_?key)[A-Za-z0-9_]*["']?\s*[=:]\s*)("[^"\s]{6,}"|'[^'\s]{6,}'|[^\s"'&|;]{6,})"#,
            2,
            looks_secret,
        ),
    ]
});

/// Every secret in `text`, earliest first, never overlapping.
pub fn find(text: &str) -> Vec<Finding> {
    let mut all: Vec<(usize, Finding)> = Vec::new();
    for (priority, rule) in RULES.iter().enumerate() {
        for caps in rule.pattern.captures_iter(text) {
            let Some(value) = caps.get(rule.value) else { continue };
            // Already a label from an earlier pass: redacting is idempotent.
            if value.as_str().starts_with("[redacted") || !(rule.plausible)(value.as_str()) {
                continue;
            }
            all.push((priority, Finding { kind: rule.kind, start: value.start(), end: value.end() }));
        }
    }
    // Earliest first; for the same start, the most specific rule.
    all.sort_by_key(|(priority, f)| (f.start, *priority));
    let mut out: Vec<Finding> = Vec::new();
    for (_, finding) in all {
        if out.last().is_some_and(|kept| finding.start < kept.end) {
            continue;
        }
        out.push(finding);
    }
    out
}

/// `text` with every secret replaced by `[redacted <kind>]`.
pub fn redact(text: &str) -> Redacted {
    let found = find(text);
    if found.is_empty() {
        return Redacted { text: text.to_string(), removed: Vec::new() };
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for f in &found {
        out.push_str(&text[at..f.start]);
        out.push_str("[redacted ");
        out.push_str(f.kind);
        out.push(']');
        at = f.end;
    }
    out.push_str(&text[at..]);
    Redacted { text: out, removed: found.iter().map(|f| f.kind).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gone(input: &str, secret: &str, kind: &str) {
        let r = redact(input);
        assert!(!r.text.contains(secret), "{kind}: the secret survived in {:?}", r.text);
        assert!(r.text.contains(&format!("[redacted {kind}]")), "{kind}: no label in {:?}", r.text);
        assert!(r.removed.contains(&kind), "{kind}: not reported, got {:?}", r.removed);
    }

    fn kept(input: &str) {
        let r = redact(input);
        assert_eq!(r.text, input, "a false positive changed {input:?}");
        assert!(r.removed.is_empty(), "{input:?} reported {:?}", r.removed);
    }

    // ---- provider and platform keys -------------------------------------

    #[test]
    fn provider_keys_are_removed() {
        gone("export ANTHROPIC=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", "anthropic-key");
        gone("key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345 here", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345", "openai-key");
        gone("legacy sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", "sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", "openai-key");
        gone("or sk-or-v1-0123456789abcdef0123456789", "sk-or-v1-0123456789abcdef0123456789", "openrouter-key");
        gone("gsk_0123456789abcdefABCDEF012345", "gsk_0123456789abcdefABCDEF012345", "groq-key");
        gone("xai-0123456789abcdefABCDEFghij", "xai-0123456789abcdefABCDEFghij", "xai-key");
        gone("AIzaSyA-0123456789abcdefghijklmnopqrstu", "AIzaSyA-0123456789abcdefghijklmnopqrstu", "google-key");
    }

    #[test]
    fn platform_tokens_are_removed() {
        gone("GH ghp_0123456789abcdefghijklmnopqrstuvwxyz", "ghp_0123456789abcdefghijklmnopqrstuvwxyz", "github-token");
        gone("github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCD", "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCD", "github-token");
        gone("aws AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE", "aws-access-key");
        gone("slack xoxb-123456789012-abcdefghijkl", "xoxb-123456789012-abcdefghijkl", "slack-token");
        gone("stripe sk_live_0123456789abcdefABCD", "sk_live_0123456789abcdefABCD", "stripe-key");
    }

    #[test]
    fn a_jwt_is_removed() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        gone(&format!("token: {jwt}"), jwt, "jwt");
    }

    #[test]
    fn a_private_key_block_is_removed_whole() {
        let block = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQyNTUxOQAAACD\n-----END OPENSSH PRIVATE KEY-----";
        let r = redact(&format!("cat id_ed25519\n{block}\n$ "));
        assert!(!r.text.contains("b3BlbnNzaC1rZXktdjEAAAAA"));
        assert!(r.text.contains("[redacted private-key]"));
        assert!(r.text.ends_with("\n$ "), "text after the block was lost: {:?}", r.text);
    }

    // ---- contexts: the value goes, the context stays --------------------

    #[test]
    fn an_authorization_header_keeps_its_scheme_and_loses_its_value() {
        let r = redact(r#"curl -H "Authorization: Bearer abc123def456ghi789" https://api.example.com"#);
        assert!(r.text.contains("Authorization: Bearer [redacted credential]"), "{}", r.text);
        assert!(!r.text.contains("abc123def456ghi789"));
    }

    #[test]
    fn a_password_in_a_url_is_removed_and_the_user_kept() {
        let r = redact("git clone https://alice:s3cr3t-pa55@github.com/org/repo.git");
        assert_eq!(r.text, "git clone https://alice:[redacted password]@github.com/org/repo.git");
    }

    #[test]
    fn secret_shaped_assignments_lose_their_values() {
        gone("export DATABASE_PASSWORD=hunter2hunter2", "hunter2hunter2", "secret");
        gone("API_KEY=\"q8Zr2LmNv4pX\"", "q8Zr2LmNv4pX", "secret");
        gone("client_secret: 9f8e7d6c5b4a3210", "9f8e7d6c5b4a3210", "secret");
        let r = redact("export GITHUB_TOKEN=abcdef123456 && make");
        assert_eq!(r.text, "export GITHUB_TOKEN=[redacted secret] && make");
    }

    #[test]
    fn password_flags_lose_their_values() {
        gone("psql --password=Tr0ub4dor&3 -h db", "Tr0ub4dor&3", "secret");
        gone("tool --token ghx-abcdefgh1234 run", "ghx-abcdefgh1234", "secret");
    }

    // ---- what must survive ---------------------------------------------

    #[test]
    fn ordinary_text_is_left_exactly_as_it_was() {
        for text in [
            "git log --oneline -5",
            "commit 9a5eaab3c1f2e4d6b8a0c2e4f6a8b0c2d4e6f8a0",
            "id 550e8400-e29b-41d4-a716-446655440000",
            "pip install scikit-learn sk-learn",
            "MAX_TOKENS=4096",
            "export TOKEN_LIMIT=100000",
            "PASSWORD_MIN_LENGTH=12",
            "export API_KEY=$API_KEY",
            "SECRET_NAME=${SECRET_NAME}",
            "echo 'token bucket rate limiter'",
            "https://example.com/path?q=1",
            "Authorization header is missing",
            "ssh git@github.com",
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        ] {
            kept(text);
        }
    }

    #[test]
    fn findings_name_kinds_and_positions_but_never_carry_the_value() {
        let text = "a sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx b";
        let found = find(text);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "anthropic-key");
        assert_eq!(&text[found[0].start..found[0].end], "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx");
    }

    #[test]
    fn several_secrets_are_all_removed_in_order() {
        let r = redact("A=ghp_0123456789abcdefghijklmnopqrstuvwxyz B=AKIAIOSFODNN7EXAMPLE");
        assert_eq!(r.removed, vec!["github-token", "aws-access-key"]);
    }

    #[test]
    fn redacting_twice_changes_nothing_more() {
        let once = redact("export GITHUB_TOKEN=abcdef123456 sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx");
        let twice = redact(&once.text);
        assert_eq!(twice.text, once.text);
        assert!(twice.removed.is_empty(), "{:?}", twice.removed);
    }

    #[test]
    fn non_ascii_text_around_a_secret_survives() {
        let r = redact("héllo → sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx ✓ 日本");
        assert_eq!(r.text, "héllo → [redacted anthropic-key] ✓ 日本");
    }
}
