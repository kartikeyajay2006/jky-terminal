//! Email alerts for events.
//!
//! Split three ways: what is due, where to send it, and the sending itself.
//! The first two have no network in them and are tested directly; the third
//! is the thin part that talks to a mail server.

mod agent;
mod config;
mod otp;
mod send;
mod run;
mod schedule;

pub use agent::{AGENT_ID, install, uninstall, AgentError, AgentFile, INTERVAL_MINUTES, windows_create_args, windows_delete_args};
pub use config::{MailConfig, PRESETS, Preset, is_verified, looks_like_an_address, preset, preset_for, why_not};
pub use otp::{OTP_TTL_SECS, OtpOutcome, OtpState, check, generate_code};
pub use send::{MailError, compose, compose_otp, explain, send, send_otp};
pub use run::{Outcome, config_path, load_config, run_once, save_config, sent_log_path};
pub use schedule::{SentLog, alert_at, due, epoch_seconds};
