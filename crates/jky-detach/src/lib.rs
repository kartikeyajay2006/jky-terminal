//! Shells that outlive the window they were opened in.
//!
//! A pty is a child of the process that spawned it, so today closing this app
//! kills every shell in it — the four-minute build, the deploy, the assistant
//! halfway through a task. That is the one thing a terminal is asked for that
//! this cannot do, and the reason people keep tmux running underneath one.
//!
//! The shape is the one `dtach` settled on decades ago and every session
//! manager since has copied: a small supervisor owns the pty and listens on a
//! socket; the window is only ever a client of it. The window dying is then
//! an ordinary disconnect rather than the end of anything.
//!
//! This module is the part that can be reasoned about without processes: the
//! wire format, the tail of output a reattaching window is owed, and the
//! rules for turning a session id into an address. Each is the piece most
//! likely to be quietly wrong — a length that allocates before it is checked,
//! a replay cut through an escape sequence, a name that is really a path —
//! and each is testable on its own.

mod client;
mod frame;
mod held;
mod launch;
mod name;
mod replay;
mod socket;
mod supervise;
#[cfg(test)]
mod testing;

pub use client::{Client, Joined, Opened, end, join, open, prune, stream};
pub use frame::{Frame, FrameError, MAX_PAYLOAD};
pub use held::{Clients, Held};
pub use launch::launch;
pub use name::{
    MAX_NAME, NameError, address, check, is_file_backed, marker, name_of, socket_dir,
};
pub use replay::{REPLAY_BYTES, Replay};
pub use socket::{attach, forget, listen, sessions};
pub use supervise::{Shell, supervise};
