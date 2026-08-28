//! The dashboard's persistent data: notes, todos, events and reminders.
//!
//! Separate from `jky-settings`, which holds preferences, and from
//! `jky-secrets`, which holds things that must never come back out. This is
//! the user's own content, and the rule that governs it is that nothing
//! leaves it except by the user's own hand: no cap, no expiry, no pruning.
//!
//! `scrollback` is the deliberate exception, and it explains itself at
//! length: terminal output is emitted rather than authored, and without a
//! bound would grow on disk exactly when something has gone wrong and printed
//! a hundred megabytes. It is capped, and kept in its own directory so the
//! difference cannot blur.

mod collection;
mod model;
pub mod scrollback;
mod store;

pub use collection::{Collection, StoreError};
pub use model::{Event, EventColour, Identified, Note, Reminder, Todo};
pub use scrollback::{ScrollbackError, MAX_BYTES as SCROLLBACK_MAX_BYTES};
pub use store::Store;
