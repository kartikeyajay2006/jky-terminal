use serde::{Deserialize, Serialize};

/// One command that ran, anywhere, at any time.
///
/// Deliberately not a terminal's scrollback. Scrollback is what a command
/// *printed* and is capped and rolling because output is emitted rather than
/// authored; this is what was *typed*, which is small, is the user's own, and
/// is the thing worth finding again a month later.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub command: String,
    /// Where it ran. `ls` here is a different answer from `ls` there.
    pub cwd: String,
    /// Zero means it worked. The shell reports it; nothing is inferred.
    pub code: i32,
    /// Milliseconds since the epoch, from the window's clock.
    pub at: i64,
    /// Which terminal it was typed in — a pane id.
    ///
    /// Kept so a search can be narrowed to one session, and so "what was I
    /// doing in that split" has an answer. Not a stable identity across
    /// restarts of the app, and not meant to be.
    pub session: String,
    /// The machine it ran on: `null` for this one, a host for an SSH session.
    ///
    /// A history that mixed a `rm` run here with one run on production and
    /// showed them identically would be a history you could not trust to
    /// re-run anything from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

/// One row of a search result: the entry, plus why it is here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hit {
    #[serde(flatten)]
    pub entry: Entry,
    /// How many times this exact command has been run, ever.
    pub count: u32,
    /// The most recent time it ran, which is not necessarily `entry.at`.
    pub last_at: i64,
}
