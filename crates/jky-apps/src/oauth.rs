//! Signing in with Google, for the Gmail app.
//!
//! The authorisation-code flow with PKCE, and the sign-in happens in the
//! person's **real browser** rather than in this app. That is not a
//! preference: since July 2023 Google detects embedded webviews at its
//! authorisation endpoint and answers `disallowed_useragent`, and no setting
//! turns it off. The stated reason is that a host app owning the webview could
//! read a password or a one-time code as it is typed — which is exactly the
//! thing this app should not be able to do.
//!
//! So the flow leaves: the browser opens, Google redirects back to a loopback
//! address this app is listening on, and one line of HTTP carries the code
//! home. Nothing else is exposed; the listener answers a single request and
//! stops.
//!
//! PKCE, not a client secret. An installed app cannot keep a secret — anyone
//! can read it out of the binary — so the exchange is bound to a random
//! verifier only this process knows instead.

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// What this app asks Google for.
///
/// Reading mail, and the address of the mailbox so the panel can say whose it
/// is. Gmail's API also offers scopes that send, modify and delete; a reader
/// needs none of them, and a test keeps them out.
pub const SCOPES: &str =
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";

#[derive(Debug, Error)]
pub enum OAuthError {
    #[error("that reply could not be read: {0}")]
    Malformed(String),
    #[error("could not reach Google: {0}")]
    Network(String),
    #[error("Google answered with status {0}")]
    Upstream(u16),
    #[error("the sign-in was not completed: {0}")]
    Declined(String),
    #[error("that sign-in did not belong to this app")]
    StateMismatch,
}

impl OAuthError {
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Network(_) => true,
            Self::Upstream(status) => *status >= 500,
            _ => false,
        }
    }
}

/// A verifier and the challenge derived from it.
pub struct Pkce {
    /// Kept in this process and sent only when redeeming the code.
    pub verifier: String,
    /// Sent in the open, in the authorisation URL.
    pub challenge: String,
}

/// The unreserved character set RFC 7636 permits in a verifier.
const VERIFIER_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/// A fresh verifier and its challenge.
///
/// 64 characters, inside the 43–128 the spec allows and well past guessing.
/// Drawn from the OS random source, because a predictable verifier is the same
/// as no verifier at all.
pub fn new_pkce() -> Pkce {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let verifier: String = (0..64)
        .map(|_| VERIFIER_CHARS[rng.gen_range(0..VERIFIER_CHARS.len())] as char)
        .collect();
    let challenge = challenge_for(&verifier);
    Pkce {
        verifier,
        challenge,
    }
}

/// A fresh `state` value for one sign-in.
///
/// PKCE proves the code came back to the process that asked for it; `state`
/// proves the redirect itself belongs to this attempt. Without it the socket
/// open on this machine would take a code from any tab that reached it, which
/// on a shared desktop is not a hypothetical.
///
/// Drawn from the same alphabet as the verifier so it crosses a URL unchanged.
pub fn new_state() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| VERIFIER_CHARS[rng.gen_range(0..VERIFIER_CHARS.len())] as char)
        .collect()
}

/// SHA-256 of the verifier, base64url, unpadded — the `S256` method.
pub fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// The loopback address Google redirects back to.
///
/// The literal address rather than `localhost`: Google matches installed-app
/// redirects on the address itself, and the two are not interchangeable. The
/// port is whatever the OS handed out, because a fixed one collides with
/// whatever else the machine happens to be running.
pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Where to send the person's browser.
pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let q = [
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        // Both are needed for a refresh token. Without one the connection
        // dies the first time the access token expires, an hour later.
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]
    .iter()
    .map(|(k, v)| format!("{k}={}", encode(v)))
    .collect::<Vec<_>>()
    .join("&");

    format!("{AUTH_ENDPOINT}?{q}")
}

/// The code, out of the one HTTP request the browser makes to the loopback.
///
/// `state` is checked before anything else is believed. It is what proves the
/// redirect belongs to the flow this app started; without it another page
/// could hand over a code from a sign-in the person never asked for.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Result<String, OAuthError> {
    let target = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| OAuthError::Malformed("that was not an HTTP request".into()))?;

    let query = target
        .split_once('?')
        .map(|(_, q)| q)
        .ok_or_else(|| OAuthError::Malformed("the redirect carried no answer".into()))?;

    let mut code = None;
    let mut state = None;
    let mut error = None;

    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        match key {
            "code" => code = Some(decode(value)),
            "state" => state = Some(decode(value)),
            "error" => error = Some(decode(value)),
            _ => {}
        }
    }

    if state.as_deref() != Some(expected_state) {
        return Err(OAuthError::StateMismatch);
    }
    if let Some(reason) = error {
        return Err(OAuthError::Declined(reason));
    }

    code.ok_or_else(|| OAuthError::Malformed("the redirect carried no code".into()))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    /// Absent on a refresh: the original stays valid, and a caller that
    /// expected a new one would throw away a working connection.
    pub refresh_token: Option<String>,
    pub expires_in_s: u64,
}

#[derive(Deserialize)]
struct WireTokens {
    access_token: Option<String>,
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: u64,
    error: Option<String>,
    error_description: Option<String>,
}

/// Google answers 400 with a body, so the status alone does not distinguish a
/// wrong code from an expired refresh token. The body does.
pub fn parse_tokens(json: &str) -> Result<Tokens, OAuthError> {
    let wire: WireTokens =
        serde_json::from_str(json).map_err(|e| OAuthError::Malformed(e.to_string()))?;

    if let Some(error) = wire.error {
        let detail = wire.error_description.unwrap_or_else(|| error.clone());
        return Err(OAuthError::Declined(format!("{error}: {detail}")));
    }

    let access_token = wire
        .access_token
        .filter(|t| !t.is_empty())
        .ok_or_else(|| OAuthError::Malformed("no token and no error".into()))?;

    Ok(Tokens {
        access_token,
        refresh_token: wire.refresh_token.filter(|t| !t.is_empty()),
        expires_in_s: wire.expires_in,
    })
}

/// Percent-encode a query value. The same encoder the rest of the crate uses.
pub(crate) fn encode(value: &str) -> String {
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

/// Undo percent-encoding on a value coming back from the browser.
fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&value[i + 1..i + 3], 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---- the loopback listener ----

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::time::Duration;

/// How long to wait for the person to finish signing in.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

/// What the browser tab is left showing.
const DONE_PAGE: &str = "\
<!doctype html><meta charset=utf-8><title>Signed in</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
<div style=\"text-align:center\"><p>You are signed in.</p>\
<p style=\"color:#666\">You can close this tab and go back to JKY Terminal.</p></div>";

/// Open a socket for Google to redirect back to.
///
/// Bound to `127.0.0.1` and never to `0.0.0.0`: on the loopback interface it
/// is reachable only from this machine, which matters because for the few
/// seconds it is open this socket will accept an authorisation code. Port 0
/// asks the OS for a free one, since a fixed port collides with whatever else
/// happens to be running.
pub fn listen() -> Result<(TcpListener, u16), OAuthError> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|e| OAuthError::Network(format!("could not open a local port: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| OAuthError::Network(e.to_string()))?
        .port();
    Ok((listener, port))
}

/// Wait for the browser's one request and take the code out of it.
///
/// Answers the tab with a page saying it worked, then stops listening. It
/// serves exactly one request: this is a doorbell, not a web server.
pub fn wait_for_code(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, OAuthError> {
    listener
        .set_nonblocking(false)
        .map_err(|e| OAuthError::Network(e.to_string()))?;

    let deadline = std::time::Instant::now() + timeout;

    loop {
        if std::time::Instant::now() > deadline {
            return Err(OAuthError::Declined("the sign-in timed out".into()));
        }

        let (mut stream, _) = listener
            .accept()
            .map_err(|e| OAuthError::Network(e.to_string()))?;

        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| OAuthError::Network(e.to_string()))?;

        let mut line = String::new();
        BufReader::new(&stream)
            .read_line(&mut line)
            .map_err(|e| OAuthError::Network(e.to_string()))?;

        // Browsers ask for a favicon too. That is not the redirect.
        if line.contains("/favicon.ico") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }

        let outcome = parse_redirect(&line, expected_state);

        let body = match &outcome {
            Ok(_) => DONE_PAGE.to_string(),
            Err(e) => format!(
                "<!doctype html><meta charset=utf-8><title>Not signed in</title>\
                 <body style=\"font:16px system-ui;padding:3rem\"><p>{e}</p>\
                 <p style=\"color:#666\">Close this tab and try again in JKY Terminal.</p>"
            ),
        };
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
        let _ = stream.flush();

        return outcome;
    }
}

// ---- redeeming the code ----

async fn post_form(
    client: &reqwest::Client,
    form: &[(&str, &str)],
) -> Result<Tokens, OAuthError> {
    let response = client
        .post(TOKEN_ENDPOINT)
        .form(form)
        .send()
        .await
        .map_err(|e| OAuthError::Network(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| OAuthError::Network(e.to_string()))?;

    // Parsed before the status is judged: Google puts the reason in the body,
    // and "invalid_grant" is a different problem from "we are down".
    match parse_tokens(&body) {
        Ok(tokens) => Ok(tokens),
        Err(_) if status.is_server_error() => Err(OAuthError::Upstream(status.as_u16())),
        Err(e) => Err(e),
    }
}

/// What the token request carries, separated from the sending of it.
///
/// Split out because the failure it hides is invisible from the outside: the
/// browser opens, consent is given, the code comes back to the loopback, and
/// only then does the one request nobody sees get refused. A missing field
/// here reads as "the sign-in did not complete" three steps later.
///
/// `client_secret` is here despite PKCE, and despite an installed app being a
/// public client under the OAuth spec. Google requires it at the token
/// endpoint for this client type — refusing the exchange with
/// `invalid_request: client_secret is missing` — while documenting the value
/// itself as not secret for installed apps, since anyone can read it out of a
/// binary they downloaded. PKCE is what actually protects the exchange; this
/// field is Google's paperwork.
pub fn exchange_form<'a>(
    client_id: &'a str,
    client_secret: &'a str,
    code: &'a str,
    verifier: &'a str,
    redirect: &'a str,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ]
}

/// The same, for trading a refresh token in for a new access token.
///
/// No `redirect_uri` — Google refuses one here — and no verifier, which would
/// mean nothing: there is no fresh authorisation to bind to.
pub fn refresh_form<'a>(
    client_id: &'a str,
    client_secret: &'a str,
    refresh_token: &'a str,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ]
}

/// Trade the code for tokens. The verifier is what proves this is the same
/// client that started the flow.
pub async fn exchange(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<Tokens, OAuthError> {
    post_form(
        client,
        &exchange_form(client_id, client_secret, code, verifier, redirect),
    )
    .await
}

/// Get a new access token with the refresh token.
pub async fn refresh(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<Tokens, OAuthError> {
    post_form(client, &refresh_form(client_id, client_secret, refresh_token)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field<'a>(form: &'a [(&str, &'a str)], name: &str) -> Option<&'a str> {
        form.iter().find(|(k, _)| *k == name).map(|(_, v)| *v)
    }

    /*
     * Google requires `client_secret` at the token endpoint even for an
     * installed app, which the OAuth spec calls a public client and PKCE
     * exists to make safe without one. Google documents the value as "not
     * treated as a secret" for this client type and still refuses the
     * exchange without it: `invalid_request: client_secret is missing`.
     *
     * The whole flow can succeed — browser opened, consent given, code
     * delivered back to the loopback — and then fail on the one request the
     * person never sees. These tests exist because the ones that came before
     * checked what Google sent back and never what was sent to it.
     */
    #[test]
    fn the_exchange_carries_the_client_secret_google_insists_on() {
        let form = exchange_form("id", "secret", "code", "verifier", "http://127.0.0.1:1");
        assert_eq!(field(&form, "client_secret"), Some("secret"));
    }

    #[test]
    fn a_refresh_carries_it_too() {
        let form = refresh_form("id", "secret", "1//0gtoken");
        assert_eq!(field(&form, "client_secret"), Some("secret"));
    }

    #[test]
    fn the_exchange_asks_to_redeem_a_code_with_the_verifier() {
        let form = exchange_form("id", "secret", "the-code", "the-verifier", "http://127.0.0.1:1");
        assert_eq!(field(&form, "grant_type"), Some("authorization_code"));
        assert_eq!(field(&form, "code"), Some("the-code"));
        // PKCE is still doing the work the secret is not: it binds the code to
        // the process that asked for it.
        assert_eq!(field(&form, "code_verifier"), Some("the-verifier"));
        assert_eq!(field(&form, "redirect_uri"), Some("http://127.0.0.1:1"));
        assert_eq!(field(&form, "client_id"), Some("id"));
    }

    #[test]
    fn a_refresh_asks_for_a_refresh_and_sends_no_code() {
        let form = refresh_form("id", "secret", "1//0gtoken");
        assert_eq!(field(&form, "grant_type"), Some("refresh_token"));
        assert_eq!(field(&form, "refresh_token"), Some("1//0gtoken"));
        assert_eq!(field(&form, "code"), None, "a refresh has no code to send");
        assert_eq!(field(&form, "code_verifier"), None);
    }

    // A verifier in a refresh would be meaningless, and a redirect_uri in one
    // is refused by Google.
    #[test]
    fn neither_form_carries_a_field_the_other_needs() {
        let exchange = exchange_form("id", "secret", "c", "v", "r");
        assert_eq!(field(&exchange, "refresh_token"), None);
        let refresh = refresh_form("id", "secret", "t");
        assert_eq!(field(&refresh, "redirect_uri"), None);
    }

    // `state` is what stops a code from somewhere else being accepted by the
    // listener sitting open on this machine, so it has to be unguessable and
    // it has to be different every time.
    #[test]
    fn a_fresh_state_is_long_enough_to_be_unguessable() {
        let state = new_state();
        assert!(state.len() >= 32, "only {} characters", state.len());
    }

    #[test]
    fn no_two_states_are_the_same() {
        let many: std::collections::HashSet<String> = (0..64).map(|_| new_state()).collect();
        assert_eq!(many.len(), 64);
    }

    // It travels in a URL and comes back out of one, so anything needing
    // escaping is a bug waiting for the round trip.
    #[test]
    fn a_state_survives_a_url_unescaped() {
        let state = new_state();
        assert_eq!(encode(&state), state);
    }

    // ---- PKCE ----

    #[test]
    fn a_verifier_is_long_enough_to_be_unguessable() {
        let pkce = new_pkce();
        // RFC 7636 permits 43–128 characters; shorter is brute-forceable.
        assert!(pkce.verifier.len() >= 43, "got {}", pkce.verifier.len());
        assert!(pkce.verifier.len() <= 128);
    }

    #[test]
    fn a_verifier_uses_only_the_characters_the_spec_allows() {
        let pkce = new_pkce();
        assert!(pkce
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
    }

    // Two flows must never share a verifier: the whole point is that only the
    // client that started the exchange can finish it.
    #[test]
    fn every_verifier_is_different() {
        let a = new_pkce();
        let b = new_pkce();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
    }

    // The challenge is the SHA-256 of the verifier, base64url, unpadded.
    // Checked against a vector from RFC 7636 itself.
    #[test]
    fn the_challenge_matches_the_rfc_worked_example() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn the_challenge_carries_no_base64_padding() {
        assert!(!challenge_for(&new_pkce().verifier).contains('='));
    }

    // ---- the authorisation url ----

    #[test]
    fn the_authorisation_url_carries_everything_google_requires() {
        let url = auth_url("id.apps.googleusercontent.com", "http://127.0.0.1:7777", "abc", "xyz");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        for part in [
            "client_id=id.apps.googleusercontent.com",
            "response_type=code",
            "code_challenge=abc",
            "code_challenge_method=S256",
            "state=xyz",
        ] {
            assert!(url.contains(part), "missing {part} in {url}");
        }
    }

    // A refresh token is only issued when both are asked for, and without one
    // the connection dies the first time the access token expires.
    #[test]
    fn the_authorisation_url_asks_for_a_refresh_token() {
        let url = auth_url("id", "http://127.0.0.1:7777", "abc", "xyz");
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
    }

    #[test]
    fn the_redirect_and_scopes_are_escaped_into_the_url() {
        let url = auth_url("id", "http://127.0.0.1:7777", "abc", "xyz");
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A7777"), "got {url}");
        assert!(!url.contains("scope=https://"), "the scope must be escaped");
    }

    // Read-only, and nothing else. Gmail's API has scopes that can send mail
    // and delete it; a reader needs neither.
    #[test]
    fn asks_only_to_read() {
        assert!(SCOPES.contains("gmail.readonly"));
        assert!(!SCOPES.contains("gmail.modify"));
        assert!(!SCOPES.contains("gmail.send"));
        assert!(!SCOPES.contains("mail.google.com"));
    }

    // ---- the redirect that comes back ----

    #[test]
    fn reads_the_code_out_of_the_redirect() {
        let got = parse_redirect("GET /?code=4/abc123&state=xyz HTTP/1.1", "xyz");
        assert_eq!(got.unwrap(), "4/abc123");
    }

    // The state is what proves the redirect belongs to the flow this app
    // started. Without checking it, another page could hand us a code from a
    // sign-in the person never asked for.
    #[test]
    fn refuses_a_redirect_whose_state_does_not_match() {
        let got = parse_redirect("GET /?code=4/abc&state=somebody-elses HTTP/1.1", "xyz");
        assert!(matches!(got, Err(OAuthError::StateMismatch)));
    }

    #[test]
    fn refuses_a_redirect_with_no_state_at_all() {
        assert!(matches!(
            parse_redirect("GET /?code=4/abc HTTP/1.1", "xyz"),
            Err(OAuthError::StateMismatch)
        ));
    }

    #[test]
    fn reads_a_refusal_as_a_refusal() {
        let got = parse_redirect("GET /?error=access_denied&state=xyz HTTP/1.1", "xyz");
        assert!(matches!(got, Err(OAuthError::Declined(_))));
    }

    #[test]
    fn decodes_a_percent_escaped_code() {
        let got = parse_redirect("GET /?code=4%2Fabc%20d&state=xyz HTTP/1.1", "xyz");
        assert_eq!(got.unwrap(), "4/abc d");
    }

    #[test]
    fn refuses_a_request_line_it_cannot_read() {
        assert!(parse_redirect("nonsense", "xyz").is_err());
        assert!(parse_redirect("GET /favicon.ico HTTP/1.1", "xyz").is_err());
    }

    // ---- the tokens ----

    #[test]
    fn reads_the_tokens_google_returns() {
        let json = r#"{"access_token":"ya29.a0","expires_in":3599,
                       "refresh_token":"1//0g","scope":"...","token_type":"Bearer"}"#;
        let t = parse_tokens(json).expect("parses");
        assert_eq!(t.access_token, "ya29.a0");
        assert_eq!(t.refresh_token.as_deref(), Some("1//0g"));
        assert_eq!(t.expires_in_s, 3599);
    }

    // A refresh returns no new refresh token; the old one stays valid, and a
    // caller that expected one would throw away a working connection.
    #[test]
    fn reads_a_refresh_reply_that_carries_no_new_refresh_token() {
        let json = r#"{"access_token":"ya29.new","expires_in":3599,"token_type":"Bearer"}"#;
        let t = parse_tokens(json).expect("parses");
        assert_eq!(t.refresh_token, None);
        assert_eq!(t.access_token, "ya29.new");
    }

    // Google answers 400 with a body; the status alone does not say which of
    // "wrong code" and "expired refresh token" happened.
    #[test]
    fn reads_an_error_reply_as_an_error() {
        let json = r#"{"error":"invalid_grant","error_description":"Bad Request"}"#;
        assert!(matches!(parse_tokens(json), Err(OAuthError::Declined(_))));
    }

    #[test]
    fn refuses_a_reply_with_no_token_and_no_error() {
        assert!(matches!(parse_tokens("{}"), Err(OAuthError::Malformed(_))));
    }

    // ---- the loopback address ----

    // Google requires the loopback address for installed apps, and the port
    // has to be whatever was free — a fixed one collides with whatever else
    // the machine is running.
    #[test]
    fn the_redirect_is_a_loopback_address() {
        let uri = redirect_uri(7777);
        assert_eq!(uri, "http://127.0.0.1:7777");
        assert!(!uri.contains("localhost"), "Google matches the literal address");
    }
}

#[cfg(test)]
mod listener_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    /// Pretend to be the browser Google redirected.
    fn knock(port: u16, request_line: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connects");
        stream
            .write_all(format!("{request_line}\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .expect("writes");
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply
    }

    // The socket accepts an authorisation code for the few seconds it is open.
    // On 0.0.0.0 that would be anyone on the network; on loopback it is only
    // this machine.
    #[test]
    fn listens_on_the_loopback_interface_only() {
        let (listener, _) = listen().expect("binds");
        let addr = listener.local_addr().expect("has an address");
        assert!(addr.ip().is_loopback(), "bound to {addr}, which is not loopback");
    }

    #[test]
    fn asks_the_operating_system_for_a_free_port() {
        let (_a, first) = listen().expect("binds");
        let (_b, second) = listen().expect("binds");
        assert_ne!(first, second, "a fixed port would collide");
        assert_ne!(first, 0);
    }

    #[test]
    fn takes_the_code_out_of_the_browsers_request() {
        let (listener, port) = listen().expect("binds");
        let caller = std::thread::spawn(move || knock(port, "GET /?code=4/live&state=st HTTP/1.1"));

        let code = wait_for_code(&listener, "st", Duration::from_secs(5)).expect("gets the code");
        assert_eq!(code, "4/live");
        assert!(caller.join().unwrap().contains("You are signed in"));
    }

    // A browser asks for a favicon the moment it renders the page. Treating
    // that as the redirect would end the flow before the code arrived.
    #[test]
    fn ignores_the_favicon_the_browser_asks_for_first() {
        let (listener, port) = listen().expect("binds");
        std::thread::spawn(move || {
            knock(port, "GET /favicon.ico HTTP/1.1");
            knock(port, "GET /?code=4/after&state=st HTTP/1.1");
        });

        let code = wait_for_code(&listener, "st", Duration::from_secs(5)).expect("gets the code");
        assert_eq!(code, "4/after");
    }

    // The tab has to say what happened. A blank page after a refused sign-in
    // leaves someone waiting for something that will not arrive.
    #[test]
    fn tells_the_browser_when_the_state_did_not_match() {
        let (listener, port) = listen().expect("binds");
        let caller =
            std::thread::spawn(move || knock(port, "GET /?code=4/x&state=wrong HTTP/1.1"));

        let outcome = wait_for_code(&listener, "st", Duration::from_secs(5));
        assert!(matches!(outcome, Err(OAuthError::StateMismatch)));
        assert!(caller.join().unwrap().contains("did not belong to this app"));
    }
}
