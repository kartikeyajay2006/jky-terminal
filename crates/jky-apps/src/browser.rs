//! What the Browser app is allowed to load, and how the address bar reads.
//!
//! Kept here rather than beside the webview code because it is the security
//! boundary and it should be testable without opening a window. Everything
//! typed into the address bar comes through `normalise`, and nothing else
//! decides what a browser webview navigates to.
//!
//! The rule is narrow on purpose: `http` and `https`, and nothing else. Every
//! other scheme is a way to reach something that is not a web page — `file://`
//! would turn the address bar into a reader for the whole disk, `javascript:`
//! runs in whatever opens it, `data:` smuggles a document past any check on
//! where it came from, and `tauri://` is this app's own origin.

use thiserror::Error;

/// Where a question goes when it is not an address.
///
/// DuckDuckGo because the promise this app makes about privacy has to be in
/// the code and not only in the prose: it does not profile the person asking.
pub const SEARCH: &str = "https://duckduckgo.com/?q=";

/// What the browser tells the sites it visits.
///
/// Deliberately ordinary. A user agent nobody else sends is a fingerprint, so
/// naming this app here would make every page it visits identifiable as this
/// app — the opposite of the point.
pub const USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// The longest address worth navigating to. Real ones are far shorter.
const MAX_URL: usize = 4096;

#[derive(Debug, Error, PartialEq)]
pub enum BrowserError {
    #[error("type an address or something to search for")]
    Empty,
    #[error("that address is too long")]
    TooLong,
    #[error("only http and https pages can be opened here")]
    UnsupportedScheme,
    #[error("that address contains characters that cannot be opened")]
    BadCharacters,
}

/// Turn what someone typed into something safe to navigate to.
///
/// Three outcomes: an address as written, a bare host with a scheme added, or
/// a search. A browser that answered a question with "invalid URL" would be a
/// worse browser than one that looked the question up.
pub fn normalise(input: &str) -> Result<String, BrowserError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(BrowserError::Empty);
    }
    if trimmed.len() > MAX_URL {
        return Err(BrowserError::TooLong);
    }
    // Checked before anything else: a control character can split a request or
    // hide the rest of an address from whoever is reading it.
    if trimmed.chars().any(char::is_control) {
        return Err(BrowserError::BadCharacters);
    }

    if let Some((scheme, _)) = trimmed.split_once("://") {
        return match scheme.to_ascii_lowercase().as_str() {
            "http" | "https" => Ok(trimmed.to_string()),
            _ => Err(BrowserError::UnsupportedScheme),
        };
    }

    // Schemes without `//` — `javascript:`, `data:`, `mailto:`, `about:` — are
    // refused before the host check, or "javascript:alert(1)" would be read as
    // a host called "javascript".
    if let Some((head, _)) = trimmed.split_once(':') {
        if !head.is_empty()
            && head.chars().all(|c| c.is_ascii_alphabetic())
            && !looks_like_host_and_port(trimmed)
        {
            return Err(BrowserError::UnsupportedScheme);
        }
    }

    if looks_like_address(trimmed) {
        // Loopback over http: a dev server is what a terminal's browser is
        // most often pointed at, and it rarely has a certificate.
        let scheme = if is_loopback(trimmed) { "http" } else { "https" };
        return Ok(format!("{scheme}://{trimmed}"));
    }

    Ok(format!("{SEARCH}{}", encode(trimmed)))
}

/// "localhost:5173" — a host and a port, rather than a scheme and a path.
fn looks_like_host_and_port(value: &str) -> bool {
    match value.split_once(':') {
        Some((host, rest)) => {
            let port: String = rest.chars().take_while(char::is_ascii_digit).collect();
            !port.is_empty() && !host.is_empty() && !host.contains(' ')
        }
        None => false,
    }
}

fn is_loopback(value: &str) -> bool {
    let host = value
        .split(['/', ':', '?'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "0.0.0.0"
}

/// Whether this reads as somewhere to go rather than something to look up.
fn looks_like_address(value: &str) -> bool {
    if value.contains(char::is_whitespace) {
        return false;
    }
    let host = value.split(['/', '?', '#']).next().unwrap_or_default();
    if is_loopback(value) {
        return true;
    }
    // A dot with something either side of it. "rust" is a search; "rust.org"
    // is a place.
    match host.split_once('.') {
        Some((before, after)) => !before.is_empty() && !after.is_empty() && !after.starts_with('.'),
        None => false,
    }
}

/// The host, for showing beside the address bar.
///
/// What a person checks before trusting a page is the host, not the query
/// string — so that is what is shown large and the rest is not.
pub fn display_host(url: &str) -> String {
    let Some((_, rest)) = url.split_once("://") else {
        return String::new();
    };
    rest.split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_string()
}

/// Percent-encode a search term. The same hand-rolled encoder the other apps
/// use, for the same reason: a dozen lines rather than another dependency.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_a_full_address_as_written() {
        assert_eq!(normalise("https://example.com/x").unwrap(), "https://example.com/x");
        assert_eq!(normalise("http://localhost:5173").unwrap(), "http://localhost:5173");
    }

    // Nobody types the scheme. A bare domain is the common case.
    #[test]
    fn assumes_https_for_a_bare_domain() {
        assert_eq!(normalise("github.com").unwrap(), "https://github.com");
        assert_eq!(normalise("github.com/rust-lang").unwrap(), "https://github.com/rust-lang");
        assert_eq!(normalise("  news.ycombinator.com  ").unwrap(), "https://news.ycombinator.com");
    }

    // A dev server is the thing a terminal's browser is most often pointed at,
    // and "localhost:5173" has a colon but no dot.
    #[test]
    fn recognises_localhost_and_a_port() {
        assert_eq!(normalise("localhost:5173").unwrap(), "http://localhost:5173");
        assert_eq!(normalise("localhost").unwrap(), "http://localhost");
        assert_eq!(normalise("127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
    }

    // Anything that is not an address is a question, and a browser that
    // answered it with "invalid URL" would be a worse browser.
    #[test]
    fn searches_for_anything_that_is_not_an_address() {
        let url = normalise("how to write a parser").unwrap();
        assert!(url.starts_with(SEARCH), "got {url}");
        assert!(url.contains("how%20to%20write%20a%20parser"), "got {url}");
    }

    #[test]
    fn searches_rather_than_guessing_at_a_single_word() {
        let url = normalise("rust").unwrap();
        assert!(url.starts_with(SEARCH), "a bare word is a search, not a host");
    }

    // The privacy promise has to be in the code, not only in the prose: the
    // engine is one that does not profile the person asking.
    #[test]
    fn searches_somewhere_that_does_not_track_the_search() {
        assert!(SEARCH.starts_with("https://duckduckgo.com/"));
    }

    // ---- what must never load ----

    #[test]
    fn refuses_a_scheme_that_is_not_the_web() {
        for bad in [
            "file:///etc/passwd",
            "FILE:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "about:config",
            "chrome://settings",
            "blob:https://example.com/x",
            "ftp://example.com",
            "tauri://localhost",
        ] {
            assert!(normalise(bad).is_err(), "{bad} should be refused");
        }
    }

    // `file://` is the one that matters most: it would turn the address bar
    // into a reader for everything on the machine.
    #[test]
    fn refuses_a_local_file_however_it_is_spelled() {
        assert!(normalise("file:///home/me/.ssh/id_rsa").is_err());
        assert!(normalise("  FiLe:///etc/shadow  ").is_err());
    }

    #[test]
    fn refuses_an_address_with_control_characters_in_it() {
        assert!(normalise("https://example.com/\u{0}x").is_err());
        assert!(normalise("https://exa\nmple.com").is_err());
    }

    #[test]
    fn refuses_an_empty_address() {
        assert!(normalise("   ").is_err());
    }

    // A megabyte pasted into the bar should be a refusal, not a megabyte-long
    // navigation.
    #[test]
    fn refuses_an_address_longer_than_any_real_one() {
        assert!(normalise(&format!("https://example.com/{}", "a".repeat(9000))).is_err());
    }

    // ---- what is shown in the bar ----

    #[test]
    fn shows_the_host_rather_than_the_whole_address() {
        assert_eq!(display_host("https://github.com/rust-lang/rust"), "github.com");
        assert_eq!(display_host("http://localhost:5173/x"), "localhost:5173");
    }

    #[test]
    fn says_nothing_for_something_that_is_not_an_address() {
        assert_eq!(display_host("not a url"), "");
    }

    // ---- the privacy posture, stated as code ----

    #[test]
    fn the_user_agent_does_not_announce_this_app() {
        // A user agent nobody else sends is a fingerprint. Naming the app here
        // would make every page this browser visits identifiable as this app.
        assert!(!USER_AGENT.to_lowercase().contains("jky"));
        assert!(!USER_AGENT.to_lowercase().contains("tauri"));
        assert!(USER_AGENT.starts_with("Mozilla/5.0"));
    }
}
