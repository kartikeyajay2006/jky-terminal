//! One pass of the alert check.
//!
//! This is what the operating system runs every few minutes with the app
//! closed. It reads the same files the app writes, sends whatever is due, and
//! exits.

use std::path::Path;

use jky_store::Store;

use crate::config::MailConfig;
use crate::schedule::{SentLog, due};

/// What a pass did, for the caller to report or log.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub sent: usize,
    pub failed: usize,
    /// Why nothing was attempted, if that is the case.
    pub skipped: Option<String>,
}

/// Where the sent log lives, beside the events it is about.
pub fn sent_log_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("alerts-sent.txt")
}

/// Where the mail settings live.
pub fn config_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("mail.json")
}

pub fn load_config(config_dir: &Path) -> MailConfig {
    // A missing or unreadable file means alerts are off, which is the safe
    // reading: it cannot turn sending on by accident.
    std::fs::read_to_string(config_path(config_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_config(config_dir: &Path, config: &MailConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let body = serde_json::to_string_pretty(config)?;
    let path = config_path(config_dir);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)
}

/// Run one pass.
///
/// `now` and the sending are both passed in, so the whole decision — what is
/// due, what is skipped, what is recorded — is testable without a mail
/// server and without waiting for a clock.
pub fn run_once<F>(
    config_dir: &Path,
    config: &MailConfig,
    now: i64,
    mut send: F,
) -> Outcome
where
    F: FnMut(&jky_store::Event, u32) -> Result<(), String>,
{
    if !config.enabled {
        // Not skipped: turning alerts off is a decision, not a problem, and
        // reporting it as one every five minutes fills a system log with
        // something nobody needs to read.
        return Outcome::default();
    }
    if let Some(why) = crate::config::why_not(config) {
        return Outcome { skipped: Some(why), ..Outcome::default() };
    }

    let store = Store::new(config_dir);
    let Ok(events) = store.events().list() else {
        return Outcome {
            skipped: Some("could not read the events file".into()),
            ..Outcome::default()
        };
    };

    let mut log = SentLog::load(sent_log_path(config_dir));
    let mut outcome = Outcome::default();

    for event in due(&events, &log, now) {
        let Some(minutes) = event.alert_minutes_before else { continue };
        match send(event, minutes) {
            Ok(()) => {
                // Recorded immediately. A crash after this point must not
                // send the same alert again on the next pass.
                let _ = log.record(&event.id);
                outcome.sent += 1;
            }
            // Not recorded, so the next pass tries again — a mail server that
            // was briefly unreachable should not cost someone their reminder.
            Err(_) => outcome.failed += 1,
        }
    }

    let _ = log.prune(&events);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::epoch_seconds;
    use jky_store::{Event, EventColour};

    fn event(id: &str, starts_at: &str, lead: Option<u32>) -> Event {
        Event {
            id: id.into(),
            title: "Team meeting".into(),
            starts_at: starts_at.into(),
            colour: EventColour::Rose,
            alert_minutes_before: lead,
        }
    }

    fn config() -> MailConfig {
        MailConfig {
            address: "someone@gmail.com".into(),
            host: "smtp.gmail.com".into(),
            port: 465,
            enabled: true,
            verified_address: None,
        }
    }

    fn noon() -> i64 {
        epoch_seconds("2026-08-27T12:00:00Z").unwrap()
    }

    /// A store with one event due at noon.
    fn ready() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        Store::new(dir.path())
            .events()
            .save(event("e1", "2026-08-27T12:30:00Z", Some(30)))
            .unwrap();
        dir
    }

    #[test]
    fn nothing_is_sent_when_alerts_are_off() {
        let dir = ready();
        let mut c = config();
        c.enabled = false;

        let out = run_once(dir.path(), &c, noon(), |_, _| panic!("must not send"));
        assert_eq!(out.sent, 0);
        // Nothing is reported: turning alerts off is a decision, not a
        // problem, and a scheduler that runs every five minutes would fill a
        // system log with it.
        assert_eq!(out.skipped, None);
    }

    #[test]
    fn nothing_is_sent_when_the_settings_are_incomplete() {
        // Half-configured must mean off, not "try anyway and fail loudly
        // every five minutes forever".
        let dir = ready();
        let mut c = config();
        c.address = String::new();

        let out = run_once(dir.path(), &c, noon(), |_, _| panic!("must not send"));
        assert_eq!(out.sent, 0);
        assert!(out.skipped.is_some());
    }

    #[test]
    fn a_due_alert_is_sent() {
        let dir = ready();
        let mut seen = Vec::new();
        let out = run_once(dir.path(), &config(), noon(), |e, m| {
            seen.push((e.id.clone(), m));
            Ok(())
        });

        assert_eq!(out.sent, 1);
        assert_eq!(seen, [("e1".to_string(), 30)]);
    }

    #[test]
    fn a_sent_alert_is_not_sent_again_on_the_next_pass() {
        // The whole reason the sent log exists.
        let dir = ready();
        run_once(dir.path(), &config(), noon(), |_, _| Ok(()));

        let out = run_once(dir.path(), &config(), noon() + 300, |_, _| {
            panic!("sent twice")
        });
        assert_eq!(out.sent, 0);
    }

    #[test]
    fn a_failed_send_is_tried_again_next_time() {
        // A mail server briefly unreachable should not cost someone their
        // reminder, so a failure is not recorded as sent.
        let dir = ready();
        let out = run_once(dir.path(), &config(), noon(), |_, _| Err("offline".into()));
        assert_eq!(out.failed, 1);
        assert_eq!(out.sent, 0);

        let out = run_once(dir.path(), &config(), noon() + 300, |_, _| Ok(()));
        assert_eq!(out.sent, 1);
    }

    #[test]
    fn one_failure_does_not_stop_the_others() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        store.events().save(event("e1", "2026-08-27T12:30:00Z", Some(30))).unwrap();
        store.events().save(event("e2", "2026-08-27T13:00:00Z", Some(60))).unwrap();

        let out = run_once(dir.path(), &config(), noon(), |e, _| {
            if e.id == "e1" { Err("no".into()) } else { Ok(()) }
        });
        assert_eq!(out.sent, 1);
        assert_eq!(out.failed, 1);
    }

    #[test]
    fn nothing_is_due_before_its_time() {
        let dir = ready();
        let out = run_once(dir.path(), &config(), noon() - 3600, |_, _| panic!("too early"));
        assert_eq!(out.sent, 0);
    }

    #[test]
    fn an_empty_store_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let out = run_once(dir.path(), &config(), noon(), |_, _| panic!("nothing to send"));
        assert_eq!(out, Outcome::default());
    }

    #[test]
    fn a_corrupt_events_file_skips_rather_than_crashing() {
        // The helper runs unattended; a panic here is a crash nobody sees.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(Store::new(dir.path()).events().path(), "not json").unwrap();

        let out = run_once(dir.path(), &config(), noon(), |_, _| panic!("must not send"));
        assert!(out.skipped.unwrap().contains("events"));
    }

    #[test]
    fn the_sent_log_is_pruned_of_events_that_are_gone() {
        // Otherwise it grows for the life of the install.
        let dir = ready();
        run_once(dir.path(), &config(), noon(), |_, _| Ok(()));
        assert_eq!(SentLog::load(sent_log_path(dir.path())).len(), 1);

        Store::new(dir.path()).events().remove("e1").unwrap();
        run_once(dir.path(), &config(), noon(), |_, _| Ok(()));
        assert!(SentLog::load(sent_log_path(dir.path())).is_empty());
    }

    #[test]
    fn config_round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        save_config(dir.path(), &config()).unwrap();
        assert_eq!(load_config(dir.path()), config());
    }

    #[test]
    fn a_missing_config_reads_as_alerts_off() {
        // The safe reading: it cannot turn sending on by accident.
        let dir = tempfile::tempdir().unwrap();
        assert!(!load_config(dir.path()).enabled);
    }

    #[test]
    fn a_corrupt_config_reads_as_alerts_off() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(config_path(dir.path()), "{ not json").unwrap();
        assert!(!load_config(dir.path()).enabled);
    }

    #[test]
    fn the_config_file_never_contains_a_password() {
        let dir = tempfile::tempdir().unwrap();
        save_config(dir.path(), &config()).unwrap();
        let raw = std::fs::read_to_string(config_path(dir.path())).unwrap();
        assert!(!raw.to_lowercase().contains("password"), "{raw}");
    }
}
