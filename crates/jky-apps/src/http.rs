//! The HTTP client tool.
//!
//! Here rather than in `jky-tools` because it is the one developer tool that
//! touches the network, and this crate is where the network lives: one shared
//! client, one place that decides how long anything waits, one retry policy.
//!
//! It is also the tool that could most easily become something else. A
//! command that takes a URL from the window and sends whatever it is told is
//! a general-purpose fetcher, which is precisely what `connect-src 'self'`
//! exists to prevent — so the rules are here, in front of it, rather than
//! left to the caller: the scheme is checked, the method is chosen from a
//! list, the header names are validated, and the response is capped.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde::Serialize;

/// The methods offered. A list, not a string, so the window cannot invent one.
pub const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/// The most response body kept.
///
/// A megabyte is far more than anyone reads in a panel and far less than a
/// streaming endpoint would hand over before someone noticed.
pub const MAX_BODY: usize = 1024 * 1024;

/// The most request body accepted.
pub const MAX_REQUEST: usize = 1024 * 1024;

/// How long a single request may take.
///
/// Longer than the app's own fetches, because this one is aimed at whatever
/// the user is building and a local server starting up is slower than a CDN.
pub const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Response {
    pub status: u16,
    /// The reason phrase, where the server sent one worth showing.
    pub status_text: String,
    /// Sorted, because a map in whatever order the wire happened to use is a
    /// list you have to search rather than read.
    pub headers: BTreeMap<String, String>,
    pub body: String,
    /// Bytes before any truncation, so "1.2 MB" is the truth about the reply.
    pub size: usize,
    pub truncated: bool,
    pub took_ms: u64,
}

/// Whether a URL is one this will send to.
///
/// `http` and `https` only. Everything else reaches something that is not a
/// web request — `file://` would make this a reader for the disk, and the
/// various application schemes launch other programs.
pub fn check_url(url: &str) -> Result<(), String> {
    let lowered = url.trim().to_ascii_lowercase();
    if !lowered.starts_with("http://") && !lowered.starts_with("https://") {
        return Err("only http and https requests can be sent".into());
    }
    if url.len() > 4096 {
        return Err("that address is too long".into());
    }
    let rest = &url[url.find("//").map(|i| i + 2).unwrap_or(0)..];
    if rest.is_empty() || rest.starts_with('/') {
        return Err("that address has no host".into());
    }
    Ok(())
}

/// Whether a method is one of the ones offered.
pub fn check_method(method: &str) -> Result<(), String> {
    if METHODS.contains(&method) {
        Ok(())
    } else {
        Err(format!("{method} is not a method this sends"))
    }
}

/// Whether a header name is a header name.
///
/// Names are a restricted token set by RFC 9110, and a name containing a
/// newline is how a header list becomes two — so this is the check that stops
/// a request being smuggled inside a header the user typed.
pub fn check_header_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 256
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b));
    if ok {
        Ok(())
    } else {
        Err(format!("'{name}' is not a header name"))
    }
}

/// Whether a header value can be sent as written.
pub fn check_header_value(value: &str) -> Result<(), String> {
    if value.len() > 8192 {
        return Err("that header value is too long".into());
    }
    if value.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0) {
        return Err("a header value cannot contain a line break".into());
    }
    Ok(())
}

/// What was asked for, after checking.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// Check everything about a request before any of it is sent.
///
/// One function so the rules are in one place and testable without a network,
/// and so the command layer cannot accidentally check three of the four.
pub fn check(request: &Request) -> Result<(), String> {
    check_method(&request.method)?;
    check_url(&request.url)?;

    for (name, value) in &request.headers {
        check_header_name(name)?;
        check_header_value(value)?;
    }

    if request.body.as_ref().is_some_and(|b| b.len() > MAX_REQUEST) {
        return Err("that request body is too large to send".into());
    }
    Ok(())
}

/// Send it, and describe what came back.
pub async fn send(client: &reqwest::Client, request: Request) -> Result<Response, String> {
    check(&request)?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "that is not a method".to_string())?;

    let mut building = client.request(method, &request.url).timeout(TIMEOUT);
    for (name, value) in &request.headers {
        building = building.header(name, value);
    }
    if let Some(body) = request.body {
        building = building.body(body);
    }

    let started = Instant::now();
    let response = building
        .send()
        .await
        .map_err(|e| describe_failure(&e))?;

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                v.to_str().unwrap_or("(not text)").to_string(),
            )
        })
        .collect();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("the reply could not be read: {e}"))?;
    let took_ms = started.elapsed().as_millis() as u64;

    let size = bytes.len();
    let truncated = size > MAX_BODY;
    let body = String::from_utf8_lossy(&bytes[..size.min(MAX_BODY)]).into_owned();

    Ok(Response {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        size,
        truncated,
        took_ms,
    })
}

/// Why a request never got an answer, in words rather than in a type name.
///
/// "error sending request for url" is what reqwest says and it names the
/// problem last; the three things that actually go wrong are a name that does
/// not resolve, a connection nobody accepted, and a wait that ran out.
fn describe_failure(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return format!("no reply within {} seconds", TIMEOUT.as_secs());
    }
    if e.is_connect() {
        return "could not connect — is it running, and is the port right?".to_string();
    }
    if e.is_request() {
        return format!("that request could not be sent: {e}");
    }
    format!("the request failed: {e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, url: &str) -> Request {
        Request {
            method: method.to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
        }
    }

    #[test]
    fn sends_only_to_the_web() {
        assert!(check_url("https://example.com/api").is_ok());
        assert!(check_url("http://localhost:3000/health").is_ok());
    }

    /*
     * A command that takes a URL and sends whatever it is told is a general
     * fetcher, which is what `connect-src 'self'` exists to prevent. These
     * are the schemes that reach something other than a web server.
     */
    #[test]
    fn refuses_every_scheme_that_is_not_the_web() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com",
            "data:text/plain,hi",
            "javascript:alert(1)",
            "//example.com",
            "example.com",
            "https://",
        ] {
            assert!(check_url(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn refuses_a_method_it_does_not_offer() {
        assert!(check_method("GET").is_ok());
        assert!(check_method("TRACE").is_err());
        assert!(check_method("get").is_err(), "methods are upper case");
        assert!(check_method("").is_err());
    }

    /*
     * A header name with a line break in it is how one header becomes two.
     *
     * This is the check that stops a whole second request being smuggled
     * inside a value the user typed, so it refuses the break rather than
     * escaping it — nothing legitimate contains one.
     */
    #[test]
    fn refuses_a_header_that_would_split_the_request() {
        assert!(check_header_name("Authorization").is_ok());
        assert!(check_header_name("X-Trace-Id").is_ok());

        assert!(check_header_name("Bad Header").is_err());
        assert!(check_header_name("X:Y").is_err());
        assert!(check_header_name("").is_err());

        assert!(check_header_value("Bearer abc").is_ok());
        assert!(check_header_value("a\r\nX-Injected: yes").is_err());
        assert!(check_header_value("a\nb").is_err());
    }

    #[test]
    fn checks_every_part_rather_than_the_first_that_fails() {
        // A good method and a bad URL still fails.
        assert!(check(&request("GET", "file:///etc/passwd")).is_err());
        // A good URL and a bad header still fails.
        let mut with_header = request("GET", "https://example.com");
        with_header.headers.push(("X\nY".into(), "v".into()));
        assert!(check(&with_header).is_err());
    }

    #[test]
    fn refuses_a_request_body_larger_than_it_will_send() {
        let mut big = request("POST", "https://example.com");
        big.body = Some("x".repeat(MAX_REQUEST + 1));
        assert!(check(&big).is_err());
    }

    #[test]
    fn accepts_an_ordinary_request() {
        let mut ordinary = request("POST", "https://example.com/api");
        ordinary.headers.push(("Content-Type".into(), "application/json".into()));
        ordinary.body = Some(r#"{"a":1}"#.into());
        assert!(check(&ordinary).is_ok());
    }

    // The list is what the window offers, so it has to hold the ones people
    // reach for and nothing exotic.
    #[test]
    fn offers_the_methods_people_use() {
        for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
            assert!(METHODS.contains(&method), "{method} is not offered");
        }
    }
}
