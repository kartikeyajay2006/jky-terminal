//! Which alerts are due, and which have already gone out.
//!
//! Pure, and separate from the sending, because this is where getting it
//! wrong is expensive in both directions: a missed alert means someone misses
//! their meeting, and a repeated one means their inbox fills up with the same
//! reminder every five minutes until the meeting starts.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use jky_store::Event;

/// Seconds since the epoch for an RFC 3339 UTC timestamp.
///
/// Parsed by hand rather than with a date crate: the format is the one this
/// app writes and validates, and the alternative is a dependency for one
/// conversion.
pub fn epoch_seconds(at: &str) -> Option<i64> {
    let b = at.as_bytes();
    if b.len() != 20 || b[10] != b'T' || b[19] != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| at.get(r)?.parse::<i64>().ok();

    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 60 {
        return None;
    }

    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s)
}

/// Days from 1970-01-01, by Howard Hinnant's civil-date algorithm.
///
/// Handles the century rule, so 2100 is not treated as a leap year.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The moment an event's alert should go out.
pub fn alert_at(event: &Event) -> Option<i64> {
    let lead = event.alert_minutes_before? as i64;
    Some(epoch_seconds(&event.starts_at)? - lead * 60)
}

/// What to send now.
///
/// An alert is due once its moment has passed and while the event itself has
/// not. The upper bound matters: a machine switched off over a long weekend
/// should not come back and mail out a fortnight of alerts for meetings that
/// have already happened.
pub fn due<'a>(events: &'a [Event], sent: &SentLog, now: i64) -> Vec<&'a Event> {
    events
        .iter()
        .filter(|e| {
            let Some(at) = alert_at(e) else { return false };
            let Some(starts) = epoch_seconds(&e.starts_at) else { return false };
            at <= now && now < starts && !sent.contains(&e.id)
        })
        .collect()
}

/// The ids already mailed.
///
/// One id per line, appended. The record has to survive the process exiting,
/// because that is the normal case: the helper runs, sends, and quits, and
/// runs again five minutes later against the same events.
#[derive(Debug, Default)]
pub struct SentLog {
    path: PathBuf,
    ids: BTreeSet<String>,
}

impl SentLog {
    /// Read what has already gone out. A missing file means nothing has.
    pub fn load(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let ids = std::fs::read_to_string(&path)
            .map(|raw| raw.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
            .unwrap_or_default();
        Self { path, ids }
    }

    pub fn contains(&self, id: &str) -> bool {
        self.ids.contains(id)
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Record that an alert went out.
    ///
    /// Written immediately rather than batched at the end: if the process
    /// dies partway through a run, the alerts already sent must not be sent
    /// again on the next one.
    pub fn record(&mut self, id: &str) -> std::io::Result<()> {
        if !self.ids.insert(id.to_string()) {
            return Ok(());
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        use std::io::Write;
        let mut file =
            std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{id}")
    }

    /// Drop records for events that no longer exist.
    ///
    /// Without this the file grows for the life of the install. An id that
    /// comes back is not a worry: ids are never reused.
    pub fn prune(&mut self, live: &[Event]) -> std::io::Result<()> {
        let alive: BTreeSet<&str> = live.iter().map(|e| e.id.as_str()).collect();
        let kept: BTreeSet<String> =
            self.ids.iter().filter(|id| alive.contains(id.as_str())).cloned().collect();
        if kept.len() == self.ids.len() {
            return Ok(());
        }
        self.ids = kept;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let body: String = self.ids.iter().map(|id| format!("{id}\n")).collect();
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_store::EventColour;

    fn event(id: &str, starts_at: &str, lead: Option<u32>) -> Event {
        Event {
            id: id.into(),
            title: "Team meeting".into(),
            starts_at: starts_at.into(),
            colour: EventColour::Rose,
            alert_minutes_before: lead,
        }
    }

    const NOON: &str = "2026-08-27T12:00:00Z";

    fn noon() -> i64 {
        epoch_seconds(NOON).unwrap()
    }

    #[test]
    fn epoch_seconds_matches_a_known_instant() {
        assert_eq!(epoch_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(epoch_seconds("2000-01-01T00:00:00Z"), Some(946_684_800));
    }

    #[test]
    fn epoch_seconds_gets_the_century_rule_right() {
        // 2100 is not a leap year, so 1 March is 59 days after 1 January.
        let jan = epoch_seconds("2100-01-01T00:00:00Z").unwrap();
        let mar = epoch_seconds("2100-03-01T00:00:00Z").unwrap();
        assert_eq!((mar - jan) / 86_400, 59);

        // 2000 is, so it is 60.
        let jan = epoch_seconds("2000-01-01T00:00:00Z").unwrap();
        let mar = epoch_seconds("2000-03-01T00:00:00Z").unwrap();
        assert_eq!((mar - jan) / 86_400, 60);
    }

    #[test]
    fn epoch_seconds_refuses_anything_that_is_not_the_stored_shape() {
        for bad in [
            "2026-08-27T12:00:00",
            "2026-08-27 12:00:00Z",
            "2026-08-27T12:00:00+05:30",
            "2026-13-27T12:00:00Z",
            "2026-08-32T12:00:00Z",
            "2026-08-27T25:00:00Z",
            "",
            "tomorrow",
        ] {
            assert!(epoch_seconds(bad).is_none(), "accepted '{bad}'");
        }
    }

    #[test]
    fn an_alert_fires_its_lead_time_before_the_event() {
        let e = event("e1", "2026-08-27T12:30:00Z", Some(30));
        assert_eq!(alert_at(&e), Some(noon()));
    }

    #[test]
    fn an_event_with_no_alert_has_no_moment() {
        assert!(alert_at(&event("e1", "2026-08-27T12:30:00Z", None)).is_none());
    }

    #[test]
    fn nothing_is_due_before_its_moment() {
        // One second early is early.
        let events = [event("e1", "2026-08-27T12:30:00Z", Some(30))];
        assert!(due(&events, &SentLog::default(), noon() - 1).is_empty());
    }

    #[test]
    fn an_alert_is_due_at_its_moment() {
        let events = [event("e1", "2026-08-27T12:30:00Z", Some(30))];
        assert_eq!(due(&events, &SentLog::default(), noon()).len(), 1);
    }

    #[test]
    fn an_alert_is_still_due_partway_through_its_lead_time() {
        // The helper runs every few minutes, so it will almost never be
        // looking at the exact second the alert became due.
        let events = [event("e1", "2026-08-27T12:30:00Z", Some(30))];
        assert_eq!(due(&events, &SentLog::default(), noon() + 600).len(), 1);
    }

    #[test]
    fn an_alert_stops_being_due_once_the_event_has_started() {
        // A machine switched off over a long weekend must not come back and
        // mail out a fortnight of alerts for meetings that already happened.
        let events = [event("e1", "2026-08-27T12:30:00Z", Some(30))];
        let starts = epoch_seconds("2026-08-27T12:30:00Z").unwrap();
        assert!(due(&events, &SentLog::default(), starts).is_empty());
        assert!(due(&events, &SentLog::default(), starts + 86_400).is_empty());
    }

    #[test]
    fn an_event_without_an_alert_is_never_due() {
        let events = [event("e1", "2026-08-27T12:30:00Z", None)];
        assert!(due(&events, &SentLog::default(), noon() + 60).is_empty());
    }

    #[test]
    fn an_unreadable_timestamp_is_skipped_rather_than_crashing() {
        // events.json can be edited by hand.
        let events = [event("e1", "whenever", Some(30))];
        assert!(due(&events, &SentLog::default(), noon()).is_empty());
    }

    #[test]
    fn several_due_alerts_all_come_back() {
        let events = [
            event("e1", "2026-08-27T12:30:00Z", Some(30)),
            event("e2", "2026-08-27T13:00:00Z", Some(60)),
        ];
        assert_eq!(due(&events, &SentLog::default(), noon() + 60).len(), 2);
    }

    #[test]
    fn a_day_long_lead_time_works_the_same_way() {
        let e = event("e1", "2026-08-28T12:00:00Z", Some(1440));
        assert_eq!(alert_at(&e), Some(noon()));
    }
}

#[cfg(test)]
mod sent_log_tests {
    use super::*;
    use jky_store::EventColour;

    fn event(id: &str) -> Event {
        Event {
            id: id.into(),
            title: "t".into(),
            starts_at: "2026-08-27T12:30:00Z".into(),
            colour: EventColour::Rose,
            alert_minutes_before: Some(30),
        }
    }

    fn temp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sent.txt");
        (dir, path)
    }

    #[test]
    fn nothing_has_been_sent_on_a_first_run() {
        let (_d, path) = temp();
        assert!(SentLog::load(&path).is_empty());
    }

    #[test]
    fn a_recorded_alert_is_remembered() {
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();
        assert!(log.contains("e1"));
    }

    #[test]
    fn the_record_survives_the_process_exiting() {
        // The normal case: the helper runs, sends, and quits, and runs again
        // five minutes later against the same events.
        let (_d, path) = temp();
        SentLog::load(&path).record("e1").unwrap();
        assert!(SentLog::load(&path).contains("e1"));
    }

    #[test]
    fn a_sent_alert_is_not_due_again() {
        // Without this, an inbox fills with the same reminder every few
        // minutes until the meeting starts.
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();

        let events = [event("e1")];
        let now = epoch_seconds("2026-08-27T12:10:00Z").unwrap();
        assert!(due(&events, &log, now).is_empty());
    }

    #[test]
    fn recording_the_same_id_twice_writes_one_line() {
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();
        log.record("e1").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 1);
    }

    #[test]
    fn each_alert_is_written_as_it_is_sent() {
        // Batching at the end of a run means a crash partway through sends
        // everything again next time.
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();
        assert!(SentLog::load(&path).contains("e1"), "not on disk yet");
        log.record("e2").unwrap();
        assert_eq!(SentLog::load(&path).len(), 2);
    }

    #[test]
    fn pruning_drops_records_for_events_that_are_gone() {
        // Otherwise the file grows for the life of the install.
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();
        log.record("e2").unwrap();

        log.prune(&[event("e1")]).unwrap();
        assert!(log.contains("e1"));
        assert!(!log.contains("e2"));
        assert!(!SentLog::load(&path).contains("e2"), "still on disk");
    }

    #[test]
    fn pruning_nothing_leaves_the_file_alone() {
        let (_d, path) = temp();
        let mut log = SentLog::load(&path);
        log.record("e1").unwrap();
        log.prune(&[event("e1")]).unwrap();
        assert!(SentLog::load(&path).contains("e1"));
    }

    #[test]
    fn a_blank_line_in_the_file_is_ignored() {
        let (_d, path) = temp();
        std::fs::write(&path, "e1\n\n\ne2\n").unwrap();
        let log = SentLog::load(&path);
        assert_eq!(log.len(), 2);
    }
}
