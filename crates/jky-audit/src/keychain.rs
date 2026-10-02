//! The anchor the app uses: the signing key and the newest link, kept in the
//! OS keychain beside API keys and away from the file a tamperer would edit.

use std::sync::{Arc, OnceLock};

use jky_secrets::{Secret, SecretError, SecretStore};

use crate::{Anchor, Head};

/// The keychain entry holding the signing key, hex-encoded.
pub const KEY_ENTRY: &str = "audit-signing-key";
/// The keychain entry holding the newest record's sequence number and link.
pub const HEAD_ENTRY: &str = "audit-head";

pub struct KeychainAnchor {
    store: Arc<dyn SecretStore>,
    create: bool,
    key: OnceLock<Option<[u8; 32]>>,
}

impl KeychainAnchor {
    /// The app's anchor: creates the signing key the first time it is needed.
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store, create: true, key: OnceLock::new() }
    }

    /// The verifier's anchor: reads the key but never creates one, so that
    /// checking a log can never change what it is checked against.
    pub fn read_only(store: Arc<dyn SecretStore>) -> Self {
        Self { store, create: false, key: OnceLock::new() }
    }

    /// Read the key, or make one. Decided once per process: a keychain that
    /// is unavailable is asked again only by the next run, not on every
    /// event — each failed lookup can cost a D-Bus round trip.
    fn load(&self) -> Option<[u8; 32]> {
        match self.store.get(KEY_ENTRY) {
            Ok(stored) => decode(stored.expose()),
            Err(SecretError::NotFound(_)) if self.create => {
                let mut key = [0u8; 32];
                getrandom::getrandom(&mut key).ok()?;
                self.store.set(KEY_ENTRY, Secret::new(crate::hex(&key))).ok()?;
                Some(key)
            }
            Err(_) => None,
        }
    }
}

fn decode(text: &str) -> Option<[u8; 32]> {
    let text = text.trim();
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

impl Anchor for KeychainAnchor {
    fn key(&self) -> Option<[u8; 32]> {
        *self.key.get_or_init(|| self.load())
    }

    fn head(&self) -> Option<Head> {
        let stored = self.store.get(HEAD_ENTRY).ok()?;
        let (seq, link) = stored.expose().split_once(' ')?;
        Some(Head { seq: seq.parse().ok()?, link: link.to_string() })
    }

    /// Best effort. A head that could not be written shows up later as
    /// records "ahead of the anchor", which says exactly what happened.
    fn set_head(&self, head: &Head) {
        let _ = self.store.set(HEAD_ENTRY, Secret::new(format!("{} {}", head.seq, head.link)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuditEvent, AuditKind, AuditLog, TailCheck};
    use jky_secrets::MemoryStore;

    fn store() -> Arc<dyn SecretStore> {
        Arc::new(MemoryStore::new())
    }

    #[test]
    fn the_key_is_created_once_and_then_reused() {
        let store = store();
        let first = KeychainAnchor::new(store.clone()).key().expect("a key");
        let again = KeychainAnchor::new(store.clone()).key().expect("the same key");
        assert_eq!(first, again);
        assert!(store.has(KEY_ENTRY).unwrap());
    }

    #[test]
    fn two_machines_get_different_keys() {
        assert_ne!(KeychainAnchor::new(store()).key(), KeychainAnchor::new(store()).key());
    }

    #[test]
    fn the_verifier_never_creates_a_key() {
        let store = store();
        assert_eq!(KeychainAnchor::read_only(store.clone()).key(), None);
        assert!(!store.has(KEY_ENTRY).unwrap());
    }

    #[test]
    fn a_damaged_key_entry_means_unsigned_rather_than_a_crash() {
        let store = store();
        store.set(KEY_ENTRY, Secret::new("not hex at all".to_string())).unwrap();
        assert_eq!(KeychainAnchor::new(store).key(), None);
    }

    #[test]
    fn check_reports_an_intact_log_with_exit_code_zero_and_an_altered_one_with_one() {
        let d = tempfile::TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        let store = store();
        let log = AuditLog::with_anchor(&path, Arc::new(KeychainAnchor::new(store.clone())));
        log.append(AuditEvent::new(AuditKind::ToolCall, "a")).unwrap();
        log.append(AuditEvent::new(AuditKind::ToolCall, "b")).unwrap();

        let (text, code) = crate::check(&path, Arc::new(KeychainAnchor::read_only(store.clone())));
        assert_eq!(code, 0, "{text}");
        assert!(text.contains(&path.display().to_string()));

        let altered = std::fs::read_to_string(&path).unwrap().replace("\"b\"", "\"c\"");
        std::fs::write(&path, altered).unwrap();
        let (text, code) = crate::check(&path, Arc::new(KeychainAnchor::read_only(store)));
        assert_eq!(code, 1, "{text}");
    }

    #[test]
    fn a_deleted_log_is_reported_when_the_keychain_remembers_records() {
        let d = tempfile::TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        let store = store();
        let log = AuditLog::with_anchor(&path, Arc::new(KeychainAnchor::new(store.clone())));
        log.append(AuditEvent::new(AuditKind::ToolCall, "a")).unwrap();
        std::fs::remove_file(&path).unwrap();
        let (text, code) = crate::check(&path, Arc::new(KeychainAnchor::read_only(store)));
        assert_eq!(code, 1, "{text}");
    }

    #[test]
    fn the_head_round_trips() {
        let anchor = KeychainAnchor::new(store());
        assert_eq!(anchor.head(), None);
        let head = Head { seq: 42, link: "ab".repeat(32) };
        anchor.set_head(&head);
        assert_eq!(anchor.head(), Some(head));
    }

    #[test]
    fn a_log_signed_by_the_app_verifies_with_the_read_only_anchor() {
        let d = tempfile::TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        let store = store();
        let log = AuditLog::with_anchor(&path, Arc::new(KeychainAnchor::new(store.clone())));
        for i in 0..3 {
            log.append(AuditEvent::new(AuditKind::ToolCall, &format!("t{i}"))).unwrap();
        }
        let checker = AuditLog::with_anchor(&path, Arc::new(KeychainAnchor::read_only(store)));
        let report = checker.verify().unwrap();
        assert!(report.intact(), "{}", report.summary());
        assert_eq!((report.signed, report.newest.clone()), (3, TailCheck::Matches));
    }
}
