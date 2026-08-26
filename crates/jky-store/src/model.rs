//! What the dashboard keeps.
//!
//! Four collections, four types. Each carries its own id so the generic
//! collection machinery in `collection.rs` can find, replace and remove a
//! record without knowing anything else about it.

use serde::{Deserialize, Serialize};

/// A record the store can address.
///
/// Implemented by all four types so one tested collection implementation
/// serves them all, rather than four near-identical copies that drift.
pub trait Identified {
    fn id(&self) -> &str;
}

/// A note.
///
/// `title` is stored rather than derived, so renaming a note does not require
/// editing its first line, and a note whose body is cleared keeps its name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    /// RFC 3339, UTC. Rendered on the reader's clock, never stored local.
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub created_at: String,
}

/// One of six named colours.
///
/// Named, not hex: a hex dot chosen against the dark theme is wrong in the
/// six other palettes and invisible in High Contrast. Each theme resolves
/// these to its own tokens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventColour {
    Rose,
    Azure,
    Mint,
    Amber,
    Violet,
    #[default]
    Cyan,
}

impl EventColour {
    /// Every colour, in the order they are offered to the user.
    pub const ALL: [EventColour; 6] = [
        EventColour::Rose,
        EventColour::Azure,
        EventColour::Mint,
        EventColour::Amber,
        EventColour::Violet,
        EventColour::Cyan,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub title: String,
    /// RFC 3339, UTC.
    pub starts_at: String,
    #[serde(default)]
    pub colour: EventColour,
    /// Minutes of warning by email. `None` means no alert for this event.
    #[serde(default)]
    pub alert_minutes_before: Option<u32>,
}

/// A daily checklist item.
///
/// `at` is a local wall-clock `HH:MM`, unlike everything else here, because
/// "07:00 morning exercise" means seven in the morning wherever you are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub text: String,
    pub at: String,
    pub done: bool,
}

macro_rules! identified {
    ($($t:ty),+) => {
        $(impl Identified for $t {
            fn id(&self) -> &str {
                &self.id
            }
        })+
    };
}

identified!(Note, Todo, Event, Reminder);
