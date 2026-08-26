//! The dashboard's persistent data: notes, todos, events and reminders.
//!
//! Separate from `jky-settings`, which holds preferences, and from
//! `jky-secrets`, which holds things that must never come back out. This is
//! the user's own content, and the rule that governs it is that nothing
//! leaves it except by the user's own hand: no cap, no expiry, no pruning.

mod collection;
mod model;
mod store;

pub use collection::{Collection, StoreError};
pub use model::{Event, EventColour, Identified, Note, Reminder, Todo};
pub use store::Store;
