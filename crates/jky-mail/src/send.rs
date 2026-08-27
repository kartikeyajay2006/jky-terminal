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

    // No separator and no dash. "Team meeting in 30 minutes" reads as a
    // sentence, and an em dash would be encoded as =?utf-8?b?...?= on the
    // wire, which is correct but pointless when plain words say the same.
    let subject = format!("{} {}", event.title, lead);

    let body = format!(
        "{title}\n\
         {when} UTC\n\
         \n\
         {sentence}\n\
         \n\
         You set this alert on the event itself. Remove it there, or turn off \
         email alerts under Dashboard, Mail Alerts, and this stops.\n",
        title = event.title,
        when = readable(&event.starts_at),
        sentence = capitalise(&lead),
    );
    (subject, body)
}

/// "in 30 minutes" to "In 30 minutes." — a sentence on its own line.
fn capitalise(lead: &str) -> String {
    let mut chars = lead.chars();
    match chars.next() {
        Some(first) => format!("{}{}.", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
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

    // Bounded before lettre sees it.
    //
    // lettre's own timeout covers reads and writes on an established socket,
    // not the connect, so a port nothing listens on hangs until the operating
    // system gives up — a full minute, watched by hand against Outlook on
    // 465. A test button that does nothing for a minute reads as a broken
    // app rather than a wrong port.
    reachable(&config.host, config.port, CONNECT_TIMEOUT)?;

    let creds = Credentials::new(config.address.clone(), password.to_string());

    let transport = transport_for(&config.host, config.port)
        .map_err(|e| MailError::Send(explain(&e.to_string())))?
        .port(config.port)
        .credentials(creds)
        .timeout(Some(IO_TIMEOUT))
        .build();

    transport.send(&message).map_err(|e| MailError::Send(explain(&e.to_string())))?;
    Ok(())
}

/// How long to wait for a server to accept a connection.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// How long to wait on an established connection.
///
/// Generously longer than the connect: a mail server that has accepted the
/// connection is talking, and a large provider can be slow to answer AUTH
/// without anything being wrong. Twenty seconds was tried and cut Outlook
/// off mid-exchange.
const IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// Can anything be reached there at all?
///
/// Every address the host resolves to is tried, because a host with both an
/// IPv6 and an IPv4 address may only be reachable on one of them from a given
/// network, and giving up on the first is how a working provider looks
/// broken.
///
/// The budget is for the whole attempt, not for each address.
/// smtp-mail.outlook.com resolves to eight of them here, and a timeout per
/// address turned a wrong port into eighty seconds of nothing.
fn reachable(host: &str, port: u16, budget: std::time::Duration) -> Result<(), MailError> {
    use std::net::ToSocketAddrs;

    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|e| MailError::Send(explain(&format!("could not resolve {host}: {e}"))))?
        .collect();

    if addrs.is_empty() {
        return Err(MailError::Send(format!("{host} does not resolve to anything.")));
    }

    let started = std::time::Instant::now();
    let mut last = String::new();
    for addr in &addrs {
        let left = budget.saturating_sub(started.elapsed());
        if left.is_zero() {
            break;
        }
        // Never less than a second each, or the last few addresses get a
        // timeout so short that a reachable one looks unreachable.
        let each = left.max(std::time::Duration::from_secs(1));
        match std::net::TcpStream::connect_timeout(addr, each) {
            Ok(_) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
    }

    Err(MailError::Send(format!(
        "Nothing answered at {host} on port {port}. Check the port — {} \
         ({last})",
        if port == 465 {
            "some providers use 587 rather than 465"
        } else {
            "some providers use 465 rather than 587"
        }
    )))
}

/// The port decides how TLS is established.
///
/// 465 is implicit TLS: encrypted from the first byte, and the whole
/// conversation including EHLO is inside it. Everything else — 587 in
/// practice — has to open in the clear and issue STARTTLS, because that is
/// the only thing listening there. iCloud offers nothing else at all, which
/// is how this was found: an implicit handshake against 587 came back as
/// "received corrupt message", rustls reading a plaintext greeting.
///
/// starttls_relay is lettre's *required* variant, not its opportunistic one:
/// if the upgrade is refused or stripped, it fails rather than sending a
/// password in the clear. Never use SmtpTransport::builder_dangerous, and
/// never set Tls::Opportunistic — either would send in plain text whenever
/// something between here and the server said to.
fn transport_for(
    host: &str,
    port: u16,
) -> Result<lettre::transport::smtp::SmtpTransportBuilder, lettre::transport::smtp::Error> {
    const IMPLICIT_TLS: u16 = 465;
    if port == IMPLICIT_TLS {
        SmtpTransport::relay(host)
    } else {
        SmtpTransport::starttls_relay(host)
    }
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
        assert_eq!(subject, "Team meeting in 30 minutes");
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
    fn the_subject_needs_no_mime_encoding() {
        // An em dash is encoded as =?utf-8?b?4oCU?= on the wire. Correct, and
        // pointless when plain words say the same thing.
        let (subject, _) = compose(&event("Team meeting", "2026-08-27T12:30:00Z"), 30);
        assert!(subject.is_ascii(), "{subject} would be encoded on the wire");
    }

    #[test]
    fn the_body_reads_as_english() {
        // It used to say "This is your in 30 minutes reminder from JKY
        // Terminal", which every test passed because they all checked that
        // the body contained things rather than that it read as a sentence.
        let (_, body) = compose(&event("Team meeting", "2026-08-27T12:30:00Z"), 30);
        assert!(body.contains("In 30 minutes."), "{body}");
        assert!(!body.contains("your in "), "{body}");
        assert!(!body.contains("is your in"), "{body}");
    }

    #[test]
    fn every_lead_time_makes_a_sentence() {
        for minutes in [0, 30, 45, 60, 120, 1440, 2880] {
            let (subject, body) = compose(&event("Standup", "2026-08-27T12:30:00Z"), minutes);
            let sentence = body.lines().nth(3).unwrap();
            assert!(
                sentence.starts_with(char::is_uppercase) && sentence.ends_with('.'),
                "{minutes} gives {sentence:?}"
            );
            assert!(subject.starts_with("Standup "), "{subject}");
        }
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
    fn a_port_nothing_listens_on_fails_quickly_rather_than_hanging() {
        // Discard reserved port 9 on localhost: resolvable, refused at once.
        let started = std::time::Instant::now();
        let err = reachable("127.0.0.1", 9, std::time::Duration::from_secs(2)).unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "took too long");
        assert!(err.to_string().contains("Nothing answered"), "{err}");
    }

    #[test]
    fn many_addresses_still_share_one_budget() {
        // smtp-mail.outlook.com resolves to eight addresses here. A timeout
        // per address turned a wrong port into eighty seconds of nothing.
        let started = std::time::Instant::now();
        let _ = reachable("localhost", 9, std::time::Duration::from_secs(3));
        assert!(
            started.elapsed() < std::time::Duration::from_secs(10),
            "took {:?}, so the budget is per address",
            started.elapsed()
        );
    }

    #[test]
    fn an_unreachable_port_suggests_the_other_one() {
        // Outlook does not answer on 465 and iCloud does not answer on 587;
        // the wrong one is the likeliest reason nothing is listening.
        let err = reachable("127.0.0.1", 465, std::time::Duration::from_secs(2)).unwrap_err();
        assert!(err.to_string().contains("587"), "{err}");

        let err = reachable("127.0.0.1", 587, std::time::Duration::from_secs(2)).unwrap_err();
        assert!(err.to_string().contains("465"), "{err}");
    }

    #[test]
    fn a_host_that_does_not_exist_says_so() {
        let err = reachable(
            "no-such-host.invalid",
            465,
            std::time::Duration::from_secs(2),
        )
        .unwrap_err();
        assert!(err.to_string().contains("server address"), "{err}");
    }

    #[test]
    fn the_connect_timeout_is_shorter_than_the_io_timeout() {
        // A connection that never opens should give up long before one that
        // is open and merely slow.
        const { assert!(CONNECT_TIMEOUT.as_secs() < IO_TIMEOUT.as_secs()) };
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
    fn port_465_is_implicit_tls_and_everything_else_negotiates() {
        // Not a cosmetic choice. An implicit handshake against 587 comes back
        // as "received corrupt message", which is rustls reading a plaintext
        // SMTP greeting — the iCloud preset failed exactly that way until
        // this existed.
        assert!(transport_for("smtp.gmail.com", 465).is_ok());
        assert!(transport_for("smtp.mail.me.com", 587).is_ok());
    }

    #[test]
    fn the_connection_is_never_left_unencrypted() {
        // The password goes over this connection. lettre offers three ways to
        // get it wrong quietly: builder_dangerous skips TLS entirely,
        // Tls::None sends in the clear, and Tls::Opportunistic upgrades only
        // if the server offers to — so anything able to strip one line from
        // the greeting gets the password. Each compiles and passes every
        // other test here, so the choice is pinned where it can be seen.
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

        for forbidden in ["builder_dangerous", "Tls::None", "Tls::Opportunistic"] {
            assert!(
                !code.contains(forbidden),
                "SECURITY: {forbidden} allows the password to go out unencrypted."
            );
        }
        assert!(code.contains("SmtpTransport::relay"), "no implicit-TLS path at all");
        assert!(
            code.contains("SmtpTransport::starttls_relay"),
            "no STARTTLS path, so port 587 cannot work"
        );
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
