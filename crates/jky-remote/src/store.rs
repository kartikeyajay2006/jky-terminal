use std::path::{Path, PathBuf};

use crate::argv::{validate, HostError};
use crate::host::Host;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("could not read the hosts: {0}")]
    Read(String),
    #[error("could not write the hosts: {0}")]
    Write(String),
    #[error("the hosts file is not valid JSON: {0}")]
    Parse(String),
    #[error("no host with that id")]
    NoSuchHost,
    #[error("{0}")]
    Host(#[from] HostError),
}

/// The machines you have saved.
///
/// A plain JSON file beside settings, because there is nothing confidential
/// in it — a hostname and an account name are not secrets, and the things
/// that are never come near this app. Putting it behind the keychain would
/// say it was confidential when it is not, which is the same argument
/// `jky-settings` makes about a public OAuth client id.
pub struct HostStore {
    path: PathBuf,
}

impl HostStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Every saved host, most recently used first.
    pub fn list(&self) -> Result<Vec<Host>, StoreError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(StoreError::Read(e.to_string())),
        };

        let mut hosts: Vec<Host> =
            serde_json::from_str(&raw).map_err(|e| StoreError::Parse(e.to_string()))?;
        hosts.sort_by(|a, b| b.last_used.cmp(&a.last_used).then(a.display().cmp(b.display())));
        Ok(hosts)
    }

    fn write(&self, hosts: &[Host]) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| StoreError::Write(e.to_string()))?;
        }
        let text =
            serde_json::to_string_pretty(hosts).map_err(|e| StoreError::Write(e.to_string()))?;
        std::fs::write(&self.path, text).map_err(|e| StoreError::Write(e.to_string()))
    }

    /// Add or replace one host, and answer with the whole list.
    ///
    /// Refused here as well as at connect time. A host that is only refused
    /// when you try to use it is one you saved, walked away from, and find
    /// broken later — and the message is worth more beside the field that
    /// caused it.
    pub fn save(&self, host: Host) -> Result<Vec<Host>, StoreError> {
        validate(&host)?;

        let mut hosts = self.list()?;
        match hosts.iter_mut().find(|h| h.id == host.id) {
            // Keeping `last_used` on an edit: renaming a machine is not using
            // it, and would otherwise shuffle it to the top of the list.
            Some(existing) => *existing = Host { last_used: existing.last_used, ..host },
            None => hosts.push(host),
        }
        self.write(&hosts)?;
        self.list()
    }

    pub fn forget(&self, id: &str) -> Result<Vec<Host>, StoreError> {
        let mut hosts = self.list()?;
        let before = hosts.len();
        hosts.retain(|h| h.id != id);
        if hosts.len() == before {
            return Err(StoreError::NoSuchHost);
        }
        self.write(&hosts)?;
        self.list()
    }

    pub fn get(&self, id: &str) -> Result<Host, StoreError> {
        self.list()?.into_iter().find(|h| h.id == id).ok_or(StoreError::NoSuchHost)
    }

    /// Note that a host was just connected to, for ordering the list.
    pub fn touch(&self, id: &str, at: i64) -> Result<(), StoreError> {
        let mut hosts = self.list()?;
        let host = hosts.iter_mut().find(|h| h.id == id).ok_or(StoreError::NoSuchHost)?;
        host.last_used = at;
        self.write(&hosts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, HostStore) {
        let d = TempDir::new().unwrap();
        let s = HostStore::new(d.path().join("hosts.json"));
        (d, s)
    }

    fn host(id: &str, address: &str) -> Host {
        Host {
            id: id.into(),
            label: String::new(),
            address: address.into(),
            user: String::new(),
            port: None,
            identity_file: None,
            jump: None,
            last_used: 0,
        }
    }

    #[test]
    fn a_missing_file_is_no_hosts_rather_than_an_error() {
        let (_d, s) = store();
        assert_eq!(s.list().unwrap(), vec![]);
    }

    #[test]
    fn a_saved_host_comes_back() {
        let (_d, s) = store();
        s.save(host("h1", "example.com")).unwrap();
        assert_eq!(s.get("h1").unwrap().address, "example.com");
    }

    #[test]
    fn saving_the_same_id_replaces_rather_than_duplicates() {
        let (_d, s) = store();
        s.save(host("h1", "example.com")).unwrap();
        let mut edited = host("h1", "elsewhere.com");
        edited.label = "renamed".into();

        let hosts = s.save(edited).unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].address, "elsewhere.com");
    }

    #[test]
    fn renaming_a_host_does_not_count_as_using_it() {
        // Or editing a machine shuffles it to the top of the list.
        let (_d, s) = store();
        s.save(host("h1", "example.com")).unwrap();
        s.touch("h1", 5_000).unwrap();

        let mut edited = host("h1", "example.com");
        edited.label = "renamed".into();
        s.save(edited).unwrap();

        assert_eq!(s.get("h1").unwrap().last_used, 5_000);
    }

    #[test]
    fn the_list_is_most_recently_used_first() {
        let (_d, s) = store();
        s.save(host("h1", "first.com")).unwrap();
        s.save(host("h2", "second.com")).unwrap();
        s.touch("h2", 9_000).unwrap();

        assert_eq!(s.list().unwrap()[0].id, "h2");
    }

    #[test]
    fn hosts_never_used_are_ordered_by_name_rather_than_arbitrarily() {
        let (_d, s) = store();
        s.save(host("h1", "zebra.com")).unwrap();
        s.save(host("h2", "alpha.com")).unwrap();
        assert_eq!(s.list().unwrap()[0].address, "alpha.com");
    }

    #[test]
    fn a_host_that_could_never_connect_is_refused_when_it_is_saved() {
        // Rather than when it is used, which is after you walked away.
        let (_d, s) = store();
        assert!(s.save(host("h1", "-oProxyCommand=sh")).is_err());
        assert_eq!(s.list().unwrap(), vec![]);
    }

    #[test]
    fn forgetting_removes_one_and_says_so_when_there_is_nothing_to_remove() {
        let (_d, s) = store();
        s.save(host("h1", "example.com")).unwrap();
        assert_eq!(s.forget("h1").unwrap(), vec![]);
        assert!(matches!(s.forget("h1"), Err(StoreError::NoSuchHost)));
    }

    #[test]
    fn asking_for_a_host_that_is_not_there_says_so() {
        let (_d, s) = store();
        assert!(matches!(s.get("nope"), Err(StoreError::NoSuchHost)));
        assert!(matches!(s.touch("nope", 1), Err(StoreError::NoSuchHost)));
    }

    #[test]
    fn a_label_is_optional_and_the_address_stands_in_for_it() {
        let (_d, s) = store();
        s.save(host("h1", "example.com")).unwrap();
        assert_eq!(s.get("h1").unwrap().display(), "example.com");

        let mut named = host("h1", "example.com");
        named.label = "production".into();
        s.save(named).unwrap();
        assert_eq!(s.get("h1").unwrap().display(), "production");
    }

    #[test]
    fn a_hosts_file_that_is_not_json_says_so_rather_than_looking_empty() {
        // Unlike the history, where one bad line among thousands is skipped:
        // this file is small, hand-editable, and losing all of it silently
        // would mean losing every machine somebody had saved.
        let (d, s) = store();
        std::fs::write(d.path().join("hosts.json"), "{ not json").unwrap();
        assert!(matches!(s.list(), Err(StoreError::Parse(_))));
    }
}
