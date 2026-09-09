//! What every key in the app is bound to.
//!
//! Until now the shortcuts were written into the components that answered
//! them, which meant there was no list of them, no way to change one, and no
//! way to find out that two of them collided.
//!
//! Nothing here presses a key or runs an action. This crate decides what a
//! keystroke *means* — which action, if any, a chord is bound to — and the
//! window does the rest. That split is what makes the awkward parts testable:
//! a conflict between two bindings is a fact about a map, not about a DOM.

mod chord;
mod map;

pub use chord::{Chord, ChordError, Key};
pub use map::{Action, Binding, Conflict, Keymap, KeymapError, KeymapFile, ACTIONS};
