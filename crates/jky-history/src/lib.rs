//! Every command you have run, and how to find it again.
//!
//! Not scrollback. Scrollback is what a command *printed* — emitted rather
//! than authored, capped and rolling, kept per terminal. This is what was
//! *typed*: small, yours, and the thing worth finding a month later. They are
//! separate files for that reason, and the distinction is the same one
//! `jky-store` draws between the dashboard's collections and its scrollback.
//!
//! Searching is a subsequence match ranked by tightness, frequency and
//! recency, because that is how people remember a command: `dkrps` for
//! `docker ps`, and the one from this afternoon before the one from March.

mod entry;
mod log;
mod search;

pub use entry::{Entry, Hit};
pub use log::{History, HistoryError, MAX_COMMAND, MAX_ENTRIES};
pub use search::{search, Query, DEFAULT_LIMIT};
