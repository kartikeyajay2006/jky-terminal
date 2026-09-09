//! What could come next on a command line.
//!
//! A completion engine is mostly one hard question — which word is the cursor
//! in, and is it a program, a flag or an argument — and then several easy
//! ones. `line` answers the hard one, with quoting and escapes and the
//! separators that start a new command, so nothing downstream has to split on
//! spaces and hope.
//!
//! Nothing here guesses. A source that cannot answer returns nothing rather
//! than something plausible: a wrong completion accepted with Tab is worse
//! than no completion at all, because the person has already stopped reading.

mod line;

mod sources;
mod engine;
mod spec;

pub use engine::{complete, Completions, Context};
pub use line::{parse, Line, Slot};
pub use sources::{Kind, Suggestion};
pub use spec::{spec_for, takes_for, Flag, Spec, Takes, SPECS};
