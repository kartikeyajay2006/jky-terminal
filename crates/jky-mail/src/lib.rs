//! Email alerts for events.
//!
//! Split three ways: what is due, where to send it, and the sending itself.
//! The first two have no network in them and are tested directly; the third
//! is the thin part that talks to a mail server.

mod config;
mod send;
mod schedule;

pub use config::{MailConfig, PRESETS, Preset, looks_like_an_address, preset, preset_for, why_not};
pub use send::{MailError, compose, explain, send};
pub use schedule::{SentLog, alert_at, due, epoch_seconds};
