//! Terminals on other machines.
//!
//! This runs the `ssh` your machine already has rather than speaking the
//! protocol itself. That is the whole design: your agent, your
//! `~/.ssh/config`, your `known_hosts` and your keys are the ones in use, so
//! a host that works in any other terminal works here, and this app never
//! becomes a second implementation of the thing standing between you and a
//! production machine. It stores no password and no key.
//!
//! What it does own is the argument list, and `argv` is where the care goes:
//! ssh takes its options as arguments, so an unchecked field is not a string
//! but an option.

mod argv;
mod host;
mod store;

pub use argv::{ssh_args, validate, HostError};
pub use host::Host;
pub use store::{HostStore, StoreError};
