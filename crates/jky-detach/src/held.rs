//! Every session this window holds, by the id the window addresses it with.
//!
//! Beside `PtyRegistry` rather than inside it. Those are the window's own
//! children, which die with it; these are connections to processes that do
//! not. Keeping them apart keeps that difference visible at every call site
//! that has to treat the two differently.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::client::{Client, Opened};

/// One session this window holds.
pub struct Held {
    /// The pane it belongs to, which is also the name its supervisor listens by.
    pub session: String,
    pub client: Client,
    replay: Mutex<Vec<u8>>,
}

impl Held {
    /// What was missed, once. Delivered when the window starts listening.
    pub fn take_replay(&self) -> Vec<u8> {
        std::mem::take(&mut *recover(&self.replay))
    }
}

/// The held sessions, by window id.
///
/// Every lock is taken with `recover`, for the reason `PtyRegistry` gives: a
/// panic elsewhere says nothing about whether an entry here is still a session,
/// and a poisoned lock refused for ever would take every terminal with it.
#[derive(Default)]
pub struct Clients {
    held: Mutex<HashMap<String, Arc<Held>>>,
    counter: Mutex<u64>,
}

/// The value behind a lock, poisoned or not.
fn recover<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Clients {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hold an opened session, and return the id the window will address it by.
    ///
    /// `held-` rather than `pty-`, so an id says at a glance which kind of
    /// terminal it names — one that outlives the window, or one that does not.
    pub fn insert(&self, session: &str, opened: Opened) -> String {
        let id = {
            let mut counter = recover(&self.counter);
            *counter += 1;
            format!("held-{counter}")
        };
        let held = Held {
            session: session.to_string(),
            client: opened.client,
            replay: Mutex::new(opened.replay),
        };
        recover(&self.held).insert(id.clone(), Arc::new(held));
        id
    }

    pub fn get(&self, id: &str) -> Option<Arc<Held>> {
        recover(&self.held).get(id).cloned()
    }

    /// The held session for a pane, with its id.
    ///
    /// Closing a pane knows the pane, not the id its terminal was given.
    pub fn by_session(&self, session: &str) -> Option<(String, Arc<Held>)> {
        recover(&self.held)
            .iter()
            .find(|(_, held)| held.session == session)
            .map(|(id, held)| (id.clone(), Arc::clone(held)))
    }

    /// Stop holding a session. What that means for its shell is the caller's
    /// to say — detach or hang up — before or after; nothing is sent here.
    pub fn remove(&self, id: &str) -> Option<Arc<Held>> {
        recover(&self.held).remove(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{open, Opened};
    use crate::supervise;
    use crate::testing::*;
    use std::time::Duration;

    #[test]
    fn a_held_session_is_found_by_id_and_by_name_and_gives_its_replay_once() {
        let dir = scratch("held");
        // The writer is named, not left to `..`: dropping it ends the fake
        // shell, and a supervisor whose shell has ended is gone before anyone
        // can join it.
        let Rig { shell, writer: _writer, .. } = fake();
        let at = dir.clone();
        let opened = open(
            &dir,
            "pane-1",
            move || {
                std::thread::spawn(move || supervise(&at, "pane-1", shell));
                Ok(())
            },
            Duration::from_secs(5),
        )
        .expect("open");

        let clients = Clients::new();
        let id = clients.insert("pane-1", Opened { replay: b"BEFORE".to_vec(), ..opened });

        assert!(id.starts_with("held-"), "an id that looks like a window-owned pty: {id}");
        assert_eq!(clients.by_session("pane-1").map(|(found, _)| found), Some(id.clone()));

        let held = clients.get(&id).expect("held");
        assert_eq!(held.session, "pane-1");
        assert_eq!(held.take_replay(), b"BEFORE");
        assert!(held.take_replay().is_empty(), "the replay was handed out twice");

        assert!(clients.remove(&id).is_some());
        assert!(clients.get(&id).is_none());
        assert!(clients.by_session("pane-1").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
