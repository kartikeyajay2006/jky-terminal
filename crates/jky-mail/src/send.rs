//! Sending one alert.
//!
//! Thin on purpose. Everything worth testing — what is due, what has gone
//! out, whether the settings make sense — is decided before anything here is
//! called, so this is left with the part that genuinely needs a server.

use jky_store::Event;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

use crate::config::MailConfig;
use crate::schedule::epoch_seconds;

#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("the alert settings are incomplete: {0}")]
    Config(String),
    #[error("could not build the message: {0}")]
    Build(String),
    #[error("{0}")]
    Send(String),
}

/// What the alert says.
///
/// Subject and body are built here rather than in the caller so the wording
/// is testable without sending anything.
pub fn compose(event: &Event, minutes: u32) -> (String, String) {
    let lead = describe_lead(minutes);
    let subject = format!("{} — {}", event.title, lead);

    let when = readable(&event.starts_at);
    let body = format!(
        "{title}\n\
         {when} UTC\n\
         \n\
         This is your {lead} reminder from JKY Terminal.\n\
         \n\
         You set this alert on the event itself. Remove it there, or turn off \
         email alerts under Dashboard, Mail Alerts, and this stops.\n",
        title = event.title,
        when = when,
        lead = lead,
    );
    (subject, body)
}

fn describe_lead(minutes: u32) -> String {
    match minutes {
        0 => "starting now".into(),
        m if m % 1440 == 0 => {
            let d = m / 1440;
            format!("in {d} day{}", if d == 1 { "" } else { "s" })
        }
        m if m % 60 == 0 => {
            let h = m / 60;
            format!("in {h} hour{}", if h == 1 { "" } else { "s" })
        }
        m => format!("in {m} minutes"),
    }
}

/// `Thu 27 Aug 2026, 12:30`, from the stored timestamp.
fn readable(at: &str) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];

    let (Some(y), Some(m), Some(d), Some(hm)) =
        (at.get(0..4), at.get(5..7), at.get(8..10), at.get(11..16))
    else {
        return at.to_string();
    };
    let Ok(month) = m.parse::<usize>() else { return at.to_string() };
    if !(1..=12).contains(&month) {
        return at.to_string();
    }

    // 1 January 1970 was a Thursday, which is why DAYS starts there.
    let weekday = match epoch_seconds(at) {
        Some(secs) => DAYS[(secs.div_euclid(86_400).rem_euclid(7)) as usize],
        None => return at.to_string(),
    };
    format!("{weekday} {} {} {y}, {hm}", d.trim_start_matches('0'), MONTHS[month - 1])
}

/// Send one alert.
///
/// `password` is taken by value and dropped at the end of the call; it is
/// never held in a struct, logged, or returned in an error.
pub fn send(
    config: &MailConfig,
    password: &str,
    event: &Event,
    minutes: u32,
) -> Result<(), MailError> {
    if let Some(why) = crate::config::why_not(config) {
        return Err(MailError::Config(why));
    }

    let (subject, body) = compose(event, minutes);

    // From and To are the same address. This is a reminder to yourself, and
    // sending anywhere else would need a recipient field that could be filled
    // in by anything that can write events.json.
    let message = Message::builder()
        .from(config.address.parse().map_err(|e| MailError::Build(format!("{e}")))?)
        .to(config.address.parse().map_err(|e| MailError::Build(format!("{e}")))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|e| MailError::Build(e.to_string()))?;

    let creds = Credentials::new(config.address.clone(), password.to_string());

    // relay() is implicit TLS from the first byte. starttls_relay() would open
    // in the clear and ask the server to upgrade, which a server — or anything
    // between — can decline.
    let transport = SmtpTransport::relay(&config.host)
        .map_err(|e| MailError::Send(explain(&e.to_string())))?
        .port(config.port)
        .credentials(creds)
        .build();

    transport.send(&message).map_err(|e| MailError::Send(explain(&e.to_string())))?;
    Ok(())
}

/// Turn a server's answer into something worth reading.
///
/// "authentication failed" is the one that matters: the account password
/// looks like the right answer and is refused by every large provider, and
/// without saying so the user will try it repeatedly.
pub fn explain(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("authentication") || lower.contains("5.7.8") || lower.contains("535") {
        return "The server refused that username and password. Most providers \
                will not accept your account password here — you need an app \
                password created in your account's security settings."
            .into();
    }
    if lower.contains("dns") || lower.contains("resolve") || lower.contains("lookup") {
        return "Could not find that mail server. Check the server address.".into();
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return "The mail server did not answer. Check the port, and whether \
                something is blocking outgoing mail."
            .into();
    }
    if lower.contains("connection refused") {
        return "The mail server refused the connection. Check the port.".into();
    }
    raw.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_store::EventColour;

    fn event(title: &str, at: &str) -> Event {
        Event {
            id: "e1".into(),
            title: title.into(),
            starts_at: at.into(),
            colour: EventColour::Rose,
            alert_minutes_before: Some(30),
        }
    }

    #[test]
    fn the_subject_names_the_event_and_when_it_is() {
        // It has to be readable in a notification, where the body is not.
        let (subject, _) = compose(&event("Team meeting", "2026-08-27T12:30:00Z"), 30);
        assert_eq!(subject, "Team meeting — in 30 minutes");
    }

    #[test]
    fn lead_times_read_as_words() {
        assert!(compose(&event("t", "2026-08-27T12:30:00Z"), 60).0.contains("in 1 hour"));
        assert!(compose(&event("t", "2026-08-27T12:30:00Z"), 120).0.contains("in 2 hours"));
        assert!(compose(&event("t", "2026-08-27T12:30:00Z"), 1440).0.contains("in 1 day"));
        assert!(compose(&event("t", "2026-08-27T12:30:00Z"), 2880).0.contains("in 2 days"));
    }

    #[test]
    fn the_body_says_when_the_event_is() {
        let (_, body) = compose(&event("Team meeting", "2026-08-27T12:30:00Z"), 30);
        assert!(body.contains("Thu 27 Aug 2026, 12:30"), "{body}");
    }

    #[test]
    fn the_body_says_which_clock_the_time_is_on() {
        // The dashboard shows local time. An email that says 12:30 without
        // saying which 12:30 is worse than one that says neither.
        let (_, body) = compose(&event("t", "2026-08-27T12:30:00Z"), 30);
        assert!(body.contains("UTC"), "{body}");
    }

    #[test]
    fn the_body_says_how_to_make_it_stop() {
        // Every automated email owes the reader this.
        let (_, body) = compose(&event("t", "2026-08-27T12:30:00Z"), 30);
        assert!(body.contains("Mail Alerts"), "{body}");
    }

    #[test]
    fn the_weekday_is_right() {
        // 1 January 1970 was a Thursday, and everything else counts from it.
        assert!(readable("1970-01-01T00:00:00Z").starts_with("Thu"));
        assert!(readable("2026-08-27T12:30:00Z").starts_with("Thu"));
        assert!(readable("2026-08-29T09:00:00Z").starts_with("Sat"));
        assert!(readable("2026-08-31T09:00:00Z").starts_with("Mon"));
    }

    #[test]
    fn an_unreadable_timestamp_is_printed_raw_rather_than_invented() {
        assert_eq!(readable("whenever"), "whenever");
        assert_eq!(readable("2026-99-27T12:30:00Z"), "2026-99-27T12:30:00Z");
    }

    #[test]
    fn sending_with_an_incomplete_config_fails_before_any_network_call() {
        // No server address, so a real attempt would hang or resolve nothing.
        let config = MailConfig::default();
        let err = send(&config, "pw", &event("t", "2026-08-27T12:30:00Z"), 30).unwrap_err();
        assert!(matches!(err, MailError::Config(_)), "{err}");
    }

    #[test]
    fn an_authentication_failure_says_it_needs_an_app_password() {
        // The account password looks like the right answer and is refused by
        // every large provider; without saying so the user tries it again.
        let msg = explain("535 5.7.8 Username and Password not accepted");
        assert!(msg.contains("app password"), "{msg}");
    }

    #[test]
    fn other_failures_are_explained_too() {
        assert!(explain("failed to lookup address information").contains("server address"));
        assert!(explain("connection timed out").contains("did not answer"));
        assert!(explain("Connection refused (os error 111)").contains("port"));
    }

    #[test]
    fn an_unrecognised_failure_is_passed_through_rather_than_swallowed() {
        // Replacing an unknown error with a friendly guess loses the only
        // information anyone had.
        assert_eq!(explain("552 message too large"), "552 message too large");
    }

    #[test]
    fn the_connection_is_encrypted_from_the_first_byte() {
        // Swapping relay() for starttls_relay() compiles, passes every other
        // test here, and quietly changes the connection to one that opens in
        // the clear and asks the server to upgrade — which the server, or
        // anything sitting between, can decline. The password goes over that
        // connection, so the choice is worth pinning where it can be seen.
        let source = include_str!("send.rs");
        // Comments out. The first version of this matched the comment above
        // the transport, which names starttls_relay in order to say why it is
        // not used, and so failed on correct code.
        let code: String = source
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            !code.contains("starttls_relay"),
            "SECURITY: the transport opens in the clear and negotiates TLS. \
             Use SmtpTransport::relay, which is encrypted from the first byte."
        );
        assert!(code.contains("SmtpTransport::relay"), "no transport is built at all");
    }

    #[test]
    fn no_error_ever_carries_the_password() {
        // The one thing that must never reach a log or the window.
        let config = MailConfig::default();
        let err = send(&config, "hunter2-app-password", &event("t", "2026-08-27T12:30:00Z"), 30)
            .unwrap_err();
        assert!(!err.to_string().contains("hunter2"), "{err}");
    }
}
