use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::session::PtySession;

/// Holds every live PTY, keyed by an id the frontend uses to address it.
///
/// Every lock here is taken with `recover` rather than `expect`, and that is
/// the difference between one bad moment and a dead application. A `Mutex` in
/// Rust is poisoned for ever once a thread panics while holding it, so
/// `expect` on these would mean a single panic anywhere near a terminal took
/// every terminal with it — not just the one, and not just then: every later
/// keystroke, resize and close would panic too, until the app was restarted.
///
/// Nothing here can leave the map in a state worth refusing to read. It is
/// ids and handles; a panic elsewhere says nothing about whether this entry
/// is still a shell. The rest of this workspace already treats a poisoned
/// lock as recoverable — see `jky-system` — and this was the one place that
/// did not.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    counter: Mutex<u64>,
}

/// The value behind a lock, poisoned or not.
fn recover<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: PtySession) -> String {
        let id = {
            let mut counter = recover(&self.counter);
            *counter += 1;
            format!("pty-{counter}")
        };

        recover(&self.sessions).insert(id.clone(), Arc::new(session));
        id
    }

    pub fn get(&self, id: &str) -> Option<Arc<PtySession>> {
        recover(&self.sessions).get(id).cloned()
    }

    /// Remove and kill. Returns whether a session was actually present.
    pub fn remove(&self, id: &str) -> bool {
        // Taken out of the map before it is killed, so the lock is not held
        // across `kill` — which talks to the operating system and has no
        // business blocking every other terminal while it does.
        let removed = recover(&self.sessions).remove(id);
        match removed {
            Some(session) => {
                let _ = session.kill();
                true
            }
            None => false,
        }
    }

    pub fn len(&self) -> usize {
        recover(&self.sessions).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::SpawnConfig;

    fn session() -> PtySession {
        PtySession::spawn(SpawnConfig::default()).expect("spawn")
    }

    #[test]
    fn a_new_registry_is_empty() {
        assert!(PtyRegistry::new().is_empty());
    }

    #[test]
    fn every_session_gets_a_distinct_id() {
        let reg = PtyRegistry::new();
        let a = reg.insert(session());
        let b = reg.insert(session());
        assert_ne!(a, b);
        assert_eq!(reg.len(), 2);
        reg.remove(&a);
        reg.remove(&b);
    }

    #[test]
    fn a_stored_session_can_be_looked_up() {
        let reg = PtyRegistry::new();
        let id = reg.insert(session());
        assert!(reg.get(&id).is_some());
        reg.remove(&id);
    }

    #[test]
    fn removing_reports_whether_anything_was_there() {
        let reg = PtyRegistry::new();
        let id = reg.insert(session());
        assert!(reg.remove(&id));
        assert!(!reg.remove(&id), "removing twice must report absence");
        assert!(reg.is_empty());
    }

    #[test]
    fn an_unknown_id_looks_up_to_nothing() {
        assert!(PtyRegistry::new().get("pty-999").is_none());
    }

    /// The registry lives in Tauri's managed state, which requires Send + Sync.
    /// A compile-time assertion catches a regression here immediately rather
    /// than as an inscrutable trait error in the command layer.
    #[test]
    fn the_registry_is_shareable_across_threads() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<PtyRegistry>();
        assert_send_sync::<Arc<PtySession>>();
    }

    /*
     * A poisoned lock must not take the application with it.
     *
     * A `Mutex` stays poisoned for ever once a thread panics holding it. With
     * `expect`, one panic anywhere near a terminal would have made every
     * later keystroke, resize and close panic too — for every terminal, until
     * the app was restarted.
     */
    #[test]
    fn a_panic_in_one_place_does_not_end_every_terminal() {
        let registry = std::sync::Arc::new(PtyRegistry::new());

        // Poison it, the way a panic while holding the lock would.
        let poisoner = {
            let registry = std::sync::Arc::clone(&registry);
            std::thread::spawn(move || {
                let _held = recover(&registry.sessions);
                panic!("something went wrong while holding the lock");
            })
        };
        assert!(poisoner.join().is_err(), "the thread should have panicked");

        // Every one of these would have panicked before.
        assert_eq!(registry.len(), 0);
        assert!(registry.get("pty-1").is_none());
        assert!(!registry.remove("pty-1"));
        assert!(registry.is_empty());
    }
}
