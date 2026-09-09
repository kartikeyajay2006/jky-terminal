use serde::{Deserialize, Serialize};

/// A machine you can open a terminal on.
///
/// Note what is absent: there is no password, and there is no key. This app
/// stores neither and asks for neither. Connecting runs the `ssh` your
/// machine already has, which means your agent, your `~/.ssh/config`, your
/// `known_hosts` and your keys are the ones in use — the same ones that work
/// in every other terminal you own. An app that reimplemented SSH would be an
/// app asking you to trust a second, younger implementation of the thing
/// standing between you and a production machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Host {
    /// Stable across renames, so a saved layout keeps pointing at the same
    /// machine when its label changes.
    pub id: String,
    /// What to call it in the list. Falls back to the address when empty.
    #[serde(default)]
    pub label: String,
    /// A hostname, an address, or a name from `~/.ssh/config`.
    pub address: String,
    /// The account. Empty means whatever ssh would use on its own.
    #[serde(default)]
    pub user: String,
    /// None means whatever ssh would use — 22, or a `Port` in your config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// A specific key file, when the agent is not enough.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    /// A machine to connect through, by the same rules as this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
    /// Milliseconds since the epoch, for ordering the list by last used.
    #[serde(default)]
    pub last_used: i64,
}

impl Host {
    /// What to show. The address when nobody named it.
    pub fn display(&self) -> &str {
        if self.label.trim().is_empty() {
            &self.address
        } else {
            &self.label
        }
    }
}
