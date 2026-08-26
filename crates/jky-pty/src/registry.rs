use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::session::PtySession;

/// Holds every live PTY, keyed by an id the frontend uses to address it.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    counter: Mutex<u64>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: PtySession) -> String {
        let id = {
            let mut counter = self.counter.lock().expect("counter lock");
            *counter += 1;
            format!("pty-{counter}")
        };

        self.sessions
            .lock()
            .expect("sessions lock")
            .insert(id.clone(), Arc::new(session));
        id
    }

    pub fn get(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.lock().expect("sessions lock").get(id).cloned()
    }

    /// Remove and kill. Returns whether a session was actually present.
    pub fn remove(&self, id: &str) -> bool {
        let removed = self.sessions.lock().expect("sessions lock").remove(id);
        match removed {
            Some(session) => {
                let _ = session.kill();
                true
            }
            None => false,
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.lock().expect("sessions lock").len()
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
}
