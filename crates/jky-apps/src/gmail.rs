//! Gmail, read-only.
//!
//! The scope asked for is `gmail.readonly` and nothing else, which is not a
//! detail of configuration but the shape of the whole module: there is no
//! send, no delete, no label change, and no code here that could grow one
//! without the consent screen changing under the person who granted it.
//!
//! Reading a mailbox takes two round trips per message, not one. The list
//! endpoint returns ids and thread ids and nothing a person could read — no
//! sender, no subject, no date — so every row on screen costs its own request.
//! Those go out together rather than in sequence, and a single one failing
//! costs its row rather than the page, the same rule the news reader follows.
//!
//! Bodies are deliberately not fetched. `format=metadata` with three named
//! headers is enough to draw a list, and it means the contents of the mail
//! never cross the IPC boundary into the window at all. The snippet Gmail
//! sends with every message is the one line of content shown, which is the
//! same line Gmail's own list view shows.

use base64::Engine;
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

/// The most rows a single view will ask for.
///
/// Each one is a request, so this is a ceiling on a burst as much as on a
/// list. Gmail's per-user rate limit is generous, but a thousand-row inbox
/// fetched in one go would be rude to it and useless to read.
pub const MAX_ROWS: usize = 50;

/// The longest a real message id is, with room to spare.
const MAX_ID: usize = 128;

/// Where the access token is kept in the OS keychain.
pub const TOKEN_KEY: &str = "gmail-access-token";

/// Where the Google client secret is kept.
///
/// In the keychain rather than in settings beside the client id, even though
/// Google documents it as not secret for an installed app — anyone can read
/// one out of a binary they downloaded, which is why PKCE and not this is
/// what protects the exchange. It is still a credential this machine holds on
/// the user's behalf, and the cost of keeping it with the tokens is nothing.
pub const CLIENT_SECRET_KEY: &str = "gmail-client-secret";

/// Where the refresh token is kept.
///
/// A separate entry rather than a field beside the access token, because the
/// two have very different lifetimes: the access token is replaced every hour
/// and the refresh token is the standing grant. Losing one should not mean
/// rewriting the other.
pub const REFRESH_KEY: &str = "gmail-refresh-token";

#[derive(Debug, Error)]
pub enum GmailError {
    #[error("Gmail sent a reply this could not read: {0}")]
    Malformed(String),
    #[error("could not reach Gmail: {0}")]
    Network(String),
    #[error("Gmail answered with status {0}")]
    Upstream(u16),
}

impl GmailError {
    /// Whether trying again is worth doing. The same rule as everywhere else
    /// in this crate: a dropped connection is a blip, an answer is an answer,
    /// and a 5xx says the far side broke rather than that we asked wrongly.
    ///
    /// A 401 is emphatically not transient — it means the token expired, and
    /// the fix is to refresh it, not to ask again with the same one.
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Network(_) => true,
            Self::Upstream(status) => *status >= 500,
            Self::Malformed(_) => false,
        }
    }
}

/// Which mailbox this is.
///
/// Shown so that someone with several Google accounts can see at a glance
/// which one they are looking at, which is the question a second account
/// makes urgent and a first account never raises.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Account {
    pub address: String,
    pub messages_total: u64,
}

/// One row in the list.
///
/// The sender is split rather than passed through whole because a row shows a
/// person, not an envelope: "Ada Lovelace" is the answer to who this is from,
/// and `Ada Lovelace <ada@example.com>` is the same answer with the machinery
/// left visible.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub from_name: String,
    pub from_address: String,
    pub subject: String,
    pub snippet: String,
    /// When it arrived, in milliseconds since the epoch.
    pub received_ms: i64,
    pub unread: bool,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WireProfile {
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
    #[serde(rename = "messagesTotal")]
    messages_total: Option<u64>,
}

#[derive(Deserialize)]
struct WireList {
    #[serde(default)]
    messages: Vec<WireRef>,
}

#[derive(Deserialize)]
struct WireRef {
    id: String,
}

#[derive(Deserialize)]
struct WireMessage {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    #[serde(rename = "labelIds", default)]
    label_ids: Vec<String>,
    #[serde(default)]
    snippet: String,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    payload: Option<WirePayload>,
}

#[derive(Deserialize)]
struct WirePayload {
    #[serde(default)]
    headers: Vec<WireHeader>,
}

#[derive(Deserialize)]
struct WireHeader {
    name: String,
    value: String,
}

pub fn parse_account(json: &str) -> Result<Account, GmailError> {
    let wire: WireProfile =
        serde_json::from_str(json).map_err(|e| GmailError::Malformed(e.to_string()))?;
    Ok(Account {
        address: wire.email_address.unwrap_or_default(),
        messages_total: wire.messages_total.unwrap_or(0),
    })
}

/// The ids a listing returned, in the order Gmail gave them — newest first.
///
/// An empty mailbox omits the field entirely rather than sending an empty
/// array, so absence has to mean "none" and not "malformed": a new account
/// showing an error instead of an empty list would be a bug on the one day it
/// is most obviously wrong.
pub fn parse_ids(json: &str) -> Result<Vec<String>, GmailError> {
    let wire: WireList =
        serde_json::from_str(json).map_err(|e| GmailError::Malformed(e.to_string()))?;
    Ok(wire.messages.into_iter().map(|m| m.id).collect())
}

pub fn parse_message(json: &str) -> Result<Message, GmailError> {
    let wire: WireMessage =
        serde_json::from_str(json).map_err(|e| GmailError::Malformed(e.to_string()))?;

    let headers = wire.payload.map(|p| p.headers).unwrap_or_default();
    let header = |wanted: &str| {
        headers
            .iter()
            // Header names are case-insensitive by RFC 5322, and Gmail is
            // consistent about capitalisation, but the mail it is relaying
            // was not necessarily written by Gmail.
            .find(|h| h.name.eq_ignore_ascii_case(wanted))
            .map(|h| h.value.trim())
            .filter(|v| !v.is_empty())
    };

    let (from_name, from_address) = split_from(header("From").unwrap_or_default());

    Ok(Message {
        thread_id: wire.thread_id.unwrap_or_else(|| wire.id.clone()),
        id: wire.id,
        from_name,
        from_address,
        subject: header("Subject").unwrap_or("(no subject)").to_string(),
        snippet: tidy(&wire.snippet),
        // A string, not a number, and milliseconds rather than the seconds the
        // rest of this crate uses.
        received_ms: wire
            .internal_date
            .and_then(|d| d.parse().ok())
            .unwrap_or(0),
        unread: wire.label_ids.iter().any(|l| l == "UNREAD"),
    })
}

/// `Ada Lovelace <ada@example.com>` into the two things a row shows.
///
/// A bare address gets used for both. Plenty of senders have no display name
/// — receipts, alerts, anything sent by a machine — and a blank where the name
/// goes would make those rows look broken rather than plain.
fn split_from(raw: &str) -> (String, String) {
    let raw = raw.trim();
    if raw.is_empty() {
        return ("(unknown sender)".to_string(), String::new());
    }

    match (raw.rfind('<'), raw.rfind('>')) {
        (Some(open), Some(close)) if close > open => {
            let address = raw[open + 1..close].trim().to_string();
            // Display names arrive quoted often enough that leaving the quotes
            // in would show them in half the rows.
            let name = raw[..open].trim().trim_matches('"').trim().to_string();
            if name.is_empty() {
                (address.clone(), address)
            } else {
                (name, address)
            }
        }
        _ => (raw.to_string(), raw.to_string()),
    }
}

/// The snippet, as a person would read it.
///
/// Gmail sends it HTML-escaped, so an apostrophe arrives as `&#39;` and would
/// be shown that way; it also carries whatever line breaks the original mail
/// had, which in a single-line row render as gaps.
fn tidy(snippet: &str) -> String {
    crate::feeds::decode_entities(snippet)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}


#[derive(Deserialize)]
struct WireFull {
    payload: Option<WirePart>,
}

/// One MIME part. The same shape at every depth, because mail nests.
#[derive(Deserialize)]
struct WirePart {
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    /// Present on attachments. Its absence is what makes a part the message.
    filename: Option<String>,
    body: Option<WirePartBody>,
    #[serde(default)]
    parts: Vec<WirePart>,
}

#[derive(Deserialize)]
struct WirePartBody {
    data: Option<String>,
}

// ---------------------------------------------------------------------------
// Reading one message
// ---------------------------------------------------------------------------

/// One message with its text, for the reading pane.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Full {
    pub message: Message,
    /// The message as text. Never markup — see `html_to_text`.
    pub body: String,
}

/// What is shown when a message carries nothing readable.
const NOTHING_TO_READ: &str =
    "There is nothing to read here — this message is an attachment with no text beside it.";

/// The whole message, bodies included.
///
/// The list deliberately never asks for this: `format=metadata` keeps message
/// contents off the network entirely. This is the one place that does, and
/// only for the single message a person asked to read.
pub fn full_url(id: &str) -> String {
    format!("{API}/messages/{id}?format=full")
}

/// Gmail encodes part bodies base64url without padding.
///
/// Not standard base64. Decoding with the wrong alphabet does not fail — `-`
/// and `_` simply decode as something else — so the result is mojibake rather
/// than an error, which is the kind of bug that reaches a screen.
pub fn decode_part(data: &str) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data.trim())
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Turn a message's HTML part into something safe to show as text.
///
/// The point is not tidiness. Rendering a stranger's markup inside this window
/// would mean their images load — and a tracking pixel is the whole reason
/// mail readers ask before loading images — and their scripts would be handed
/// to whatever renders them. Neither can happen if the markup never survives
/// Rust.
///
/// `script` and `style` go with their contents; everything else keeps its
/// text. The block-level tags become newlines, because a paragraph break is
/// meaning rather than decoration.
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html.to_string();

    // Elements whose *contents* are not prose. Dropped whole.
    for tag in ["script", "style", "head"] {
        rest = drop_element(&rest, tag);
    }

    let mut in_tag = false;
    let mut tag = String::new();
    for c in rest.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let name = tag.trim_start_matches('/').trim().to_ascii_lowercase();
                let name = name.split_whitespace().next().unwrap_or("");
                if matches!(
                    name,
                    "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "h4" | "blockquote"
                ) {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(c),
            _ => out.push(c),
        }
    }

    tidy_lines(&crate::feeds::decode_entities(&out))
}

/// Remove one element and everything inside it.
///
/// Owned rather than borrowed, because each pass consumes the previous pass's
/// output. An earlier version kept a `&str` across passes by leaking the
/// intermediate — which worked, and leaked a copy of every message body the
/// reader ever opened.
///
/// An unclosed tag swallows the rest of the document. That is the
/// conservative answer rather than the convenient one: the alternative is
/// deciding that an unterminated `<script` is prose.
fn drop_element(html: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut cursor = html;

    while let Some(start) = cursor.to_ascii_lowercase().find(&open) {
        out.push_str(&cursor[..start]);
        let after = &cursor[start..];
        match after.to_ascii_lowercase().find(&close) {
            Some(end) => cursor = &after[end + close.len()..],
            None => return out,
        }
    }
    out.push_str(cursor);
    out
}

/// Trailing spaces gone and no more than one blank line in a row.
///
/// Mail is written by machines as often as by people, and machine-written HTML
/// indents every tag — which becomes a page of blank lines the moment the tags
/// are removed.
fn tidy_lines(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_end().to_string();
        let blank = trimmed.trim().is_empty();
        if blank && lines.last().is_some_and(|l: &String| l.trim().is_empty()) {
            continue;
        }
        lines.push(trimmed);
    }
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

/// The best text in a message, and where it was found.
///
/// Depth-first, because mail nests: `multipart/mixed` holding a
/// `multipart/alternative` holding the parts that are actually text is the
/// ordinary shape, not an exotic one. A reader that looked only one level down
/// would find nothing in most real mail.
///
/// A part with a filename is an attachment and is skipped whatever its type —
/// a `.txt` attachment is a file someone sent, not the message.
fn text_in(part: &WirePart, plain: &mut Option<String>, html: &mut Option<String>) {
    if part.filename.as_deref().is_some_and(|f| !f.is_empty()) {
        return;
    }

    let mime = part.mime_type.as_deref().unwrap_or("").to_ascii_lowercase();
    if let Some(data) = part.body.as_ref().and_then(|b| b.data.as_deref()) {
        if mime.starts_with("text/plain") && plain.is_none() {
            *plain = decode_part(data);
        } else if mime.starts_with("text/html") && html.is_none() {
            *html = decode_part(data);
        }
    }

    for child in &part.parts {
        text_in(child, plain, html);
    }
}

pub fn parse_full(json: &str) -> Result<Full, GmailError> {
    let message = parse_message(json)?;

    let wire: WireFull =
        serde_json::from_str(json).map_err(|e| GmailError::Malformed(e.to_string()))?;

    let mut plain = None;
    let mut html = None;
    if let Some(payload) = wire.payload.as_ref() {
        text_in(payload, &mut plain, &mut html);
    }

    // Plain wins when both exist. Not a preference: the HTML alternative says
    // the same thing and can also phone home.
    let body = plain
        .map(|t| tidy_lines(&t))
        .or_else(|| html.map(|h| html_to_text(&h)))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| NOTHING_TO_READ.to_string());

    Ok(Full { message, body })
}

/// One message, with its text, for the reading pane.
pub async fn fetch_full(
    client: &reqwest::Client,
    token: &str,
    id: &str,
) -> Result<Full, GmailError> {
    if !safe_id(id) {
        return Err(GmailError::Malformed("that is not a message id".into()));
    }
    parse_full(&api_get(client, &full_url(id), token).await?)
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/// Whether this could be a message id, checked before it reaches a URL path.
///
/// Refused rather than escaped. Escaping would make `../../users/someone-else`
/// safe and also useless; no real id contains a slash, a dot or a question
/// mark, so anything that does is a mistake or an attempt, and both deserve
/// the same answer.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn profile_url() -> String {
    format!("{API}/profile")
}

/// A listing.
///
/// With no query this is the inbox, which is what the panel opens on. With
/// one it is all mail, because a person searching for something has already
/// said where to look and "not in your inbox" is rarely the answer they
/// wanted.
pub fn list_url(count: usize, query: Option<&str>) -> String {
    let count = count.clamp(1, MAX_ROWS);
    match query.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => format!(
            "{API}/messages?maxResults={count}&q={}",
            crate::oauth::encode(q)
        ),
        None => format!("{API}/messages?maxResults={count}&labelIds=INBOX"),
    }
}

/// One message, in the shape a list row needs.
///
/// `format=metadata` with three named headers, so the body is never sent.
/// `format=full` would work and would also mean the entire contents of every
/// mail crossed the network and the IPC boundary to draw a line of text.
pub fn message_url(id: &str) -> String {
    format!(
        "{API}/messages/{id}?format=metadata\
         &metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
    )
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async fn api_get(client: &reqwest::Client, url: &str, token: &str) -> Result<String, GmailError> {
    crate::net::retrying(crate::net::ATTEMPTS, GmailError::is_transient, || async {
        let response = client
            .get(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| GmailError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(GmailError::Upstream(status.as_u16()));
        }

        response
            .text()
            .await
            .map_err(|e| GmailError::Network(e.to_string()))
    })
    .await
}

pub async fn fetch_account(client: &reqwest::Client, token: &str) -> Result<Account, GmailError> {
    parse_account(&api_get(client, &profile_url(), token).await?)
}

/// A list of messages, ready to draw.
///
/// The metadata requests go out together rather than one after another: fifty
/// sequential round trips to Google would take the better part of a minute,
/// and the same fifty in parallel take one.
///
/// One of them failing costs its row rather than the whole list. That is the
/// news reader's rule, and it holds for the same reason — a single unlucky
/// request should not turn a full mailbox into an error page. An empty list
/// stays empty rather than becoming an error, because an empty inbox is a
/// real thing that happens to real people.
pub async fn fetch_messages(
    client: &reqwest::Client,
    token: &str,
    count: usize,
    query: Option<&str>,
) -> Result<Vec<Message>, GmailError> {
    let ids = parse_ids(&api_get(client, &list_url(count, query), token).await?)?;

    let fetched = join_all(ids.iter().filter(|id| safe_id(id)).map(|id| async move {
        let body = api_get(client, &message_url(id), token).await.ok()?;
        parse_message(&body).ok()
    }))
    .await;

    Ok(fetched.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two accounts, two keys. One name for both would mean disconnecting
    // GitHub silently signed you out of Gmail.
    #[test]
    fn keeps_its_tokens_under_names_no_other_account_uses() {
        let keys = [TOKEN_KEY, REFRESH_KEY, CLIENT_SECRET_KEY, crate::github::TOKEN_KEY];
        let unique: std::collections::HashSet<&str> = keys.iter().copied().collect();
        assert_eq!(unique.len(), keys.len(), "two of {keys:?} are the same entry");
    }

    const LIST: &str = include_str!("../fixtures/gmail-list.json");
    const MESSAGE: &str = include_str!("../fixtures/gmail-message.json");
    const PLAIN: &str = include_str!("../fixtures/gmail-message-plain.json");
    const PROFILE: &str = include_str!("../fixtures/gmail-profile.json");
    const ALTERNATIVE: &str = include_str!("../fixtures/gmail-full-alternative.json");
    const HTML_ONLY: &str = include_str!("../fixtures/gmail-full-html.json");
    const BARE: &str = include_str!("../fixtures/gmail-full-bare.json");

    // ---- reading one message ----

    // Mail is nested: multipart/mixed holding multipart/alternative holding
    // the parts that are actually text. A reader that only looked one level
    // down would find nothing in most real mail.
    #[test]
    fn reads_the_text_of_a_message() {
        let m = parse_full(ALTERNATIVE).expect("fixture parses");
        assert!(m.body.contains("the deploy finished"), "got {:?}", m.body);
        assert!(m.body.contains("Smoke tests are green"));
        assert_eq!(m.message.subject, "Deploy finished");
    }

    /*
     * When a message carries both, the plain part is the one to show.
     *
     * Not a preference: rendering the HTML would mean rendering a stranger's
     * markup inside this window, and every mail with a tracking pixel in it
     * would announce that it had been opened. The plain part says the same
     * thing and cannot do either.
     */
    #[test]
    fn prefers_the_plain_part_over_the_html_one() {
        let m = parse_full(ALTERNATIVE).expect("fixture parses");
        assert!(!m.body.contains('<'), "markup reached the reader: {:?}", m.body);
        assert!(!m.body.contains("tracker.example.com"));
    }

    // Plenty of mail is HTML and nothing else. Showing nothing would be
    // wrong; showing the markup would be worse.
    #[test]
    fn falls_back_to_the_html_part_as_text() {
        let m = parse_full(HTML_ONLY).expect("fixture parses");
        assert!(m.body.contains("the deploy"), "got {:?}", m.body);
        assert!(!m.body.contains('<'), "markup reached the reader: {:?}", m.body);
    }

    // A tracking pixel is the whole reason mail readers ask before loading
    // images. Nothing here can request one, because the tag is gone before
    // the text leaves Rust.
    #[test]
    fn nothing_in_a_message_can_reach_back_out_to_its_sender() {
        let m = parse_full(HTML_ONLY).expect("fixture parses");
        for leak in ["tracker.example.com", "<img", "src=", "<script", "alert("] {
            assert!(!m.body.contains(leak), "{leak} survived: {:?}", m.body);
        }
    }

    #[test]
    fn decodes_the_entities_an_html_part_carries() {
        let m = parse_full(HTML_ONLY).expect("fixture parses");
        assert!(!m.body.contains("&mdash;"), "got {:?}", m.body);
    }

    // The simplest message there is: no parts, the body on the payload.
    #[test]
    fn reads_a_message_that_has_no_parts_at_all() {
        let m = parse_full(BARE).expect("fixture parses");
        assert_eq!(m.body.trim(), "Just one line.");
    }

    // An attachment is not the message, and its bytes are not text.
    #[test]
    fn does_not_treat_an_attachment_as_the_message() {
        let m = parse_full(HTML_ONLY).expect("fixture parses");
        assert!(!m.body.contains("receipt.pdf"));
        assert!(!m.body.contains("ANGjdJ"));
    }

    // Nothing readable is a real outcome — a message that is only an
    // attachment. Saying so beats an empty pane that looks like a failure.
    #[test]
    fn says_when_there_is_nothing_to_read() {
        let json = r#"{"id":"x","internalDate":"0","payload":{"headers":[],
            "mimeType":"application/pdf","filename":"a.pdf","body":{"size":9}}}"#;
        let m = parse_full(json).expect("parses");
        assert!(m.body.contains("nothing"), "got {:?}", m.body);
    }

    // An unterminated script tag is not prose. Swallowing the remainder is
    // the conservative answer; the alternative is showing whatever a
    // malformed message wanted shown.
    #[test]
    fn an_unclosed_script_takes_the_rest_with_it() {
        let text = html_to_text("<p>Before</p><script>alert(1)");
        assert!(text.contains("Before"));
        assert!(!text.contains("alert"), "got {text:?}");
    }

    // Machine-written HTML indents every tag, which becomes a page of blank
    // lines the moment the tags are gone.
    #[test]
    fn does_not_turn_indented_markup_into_a_page_of_blank_lines() {
        let text = html_to_text("<div>\n  <p>One</p>\n\n  <p>Two</p>\n</div>");
        assert!(!text.contains("\n\n\n"), "got {text:?}");
        assert!(text.starts_with("One"), "got {text:?}");
        assert!(text.trim_end().ends_with("Two"), "got {text:?}");
    }

    #[test]
    fn refuses_a_full_message_it_cannot_read() {
        assert!(parse_full("not json").is_err());
    }

    // Gmail encodes part bodies base64url, not standard base64, and without
    // padding. Decoding with the wrong alphabet gives mojibake, not an error.
    #[test]
    fn decodes_the_url_safe_base64_gmail_uses() {
        assert_eq!(decode_part("SGVsbG8sIHdvcmxk"), Some("Hello, world".to_string()));
        assert_eq!(decode_part("Pz8_Pg"), Some("??\u{3f}>".to_string()));
        assert_eq!(decode_part("not base64!!"), None);
        assert_eq!(decode_part(""), None);
    }

    // A body is asked for by id, so the same guard the list uses applies.
    #[test]
    fn asks_for_the_whole_message_only_when_reading_one() {
        let url = full_url("18f0a1");
        assert!(url.contains("/messages/18f0a1"));
        assert!(url.contains("format=full"));
        assert!(!url.contains("format=metadata"));
    }


    #[test]
    fn reads_which_mailbox_this_is() {
        let p = parse_account(PROFILE).expect("fixture parses");
        assert_eq!(p.address, "someone@example.com");
        assert_eq!(p.messages_total, 12043);
    }

    // The list endpoint returns ids and nothing else; every subject and sender
    // needs a second request, which is why the panel fetches them in parallel.
    #[test]
    fn reads_the_ids_a_listing_returns() {
        let ids = parse_ids(LIST).expect("fixture parses");
        assert_eq!(ids, ["18f0a1", "18f0a2"]);
    }

    #[test]
    fn reads_an_empty_mailbox_as_empty_rather_than_an_error() {
        assert!(parse_ids(r#"{"resultSizeEstimate":0}"#).expect("parses").is_empty());
    }

    #[test]
    fn reads_a_message() {
        let m = parse_message(MESSAGE).expect("fixture parses");
        assert_eq!(m.id, "18f0a1");
        assert_eq!(m.subject, "Deploy finished");
        assert!(m.unread);
    }

    // A row shows who it is from, and "Ada Lovelace" is the answer, not
    // "Ada Lovelace <ada@example.com>".
    #[test]
    fn separates_the_senders_name_from_their_address() {
        let m = parse_message(MESSAGE).expect("fixture parses");
        assert_eq!(m.from_name, "Ada Lovelace");
        assert_eq!(m.from_address, "ada@example.com");
    }

    // Plenty of senders have no display name at all.
    #[test]
    fn falls_back_to_the_address_when_there_is_no_name() {
        let m = parse_message(PLAIN).expect("fixture parses");
        assert_eq!(m.from_name, "billing@example.net");
        assert_eq!(m.from_address, "billing@example.net");
    }

    #[test]
    fn knows_which_messages_have_been_read() {
        assert!(parse_message(MESSAGE).unwrap().unread);
        assert!(!parse_message(PLAIN).unwrap().unread);
    }

    // Gmail sends the snippet HTML-escaped, so an apostrophe arrives as
    // `&#39;` and would be shown that way.
    #[test]
    fn unescapes_the_snippet_gmail_sends() {
        let m = parse_message(MESSAGE).expect("fixture parses");
        assert!(m.snippet.contains("Nothing to do'"), "got {}", m.snippet);
        assert!(!m.snippet.contains("&#39;"));
    }

    // internalDate is milliseconds as a *string*, which is neither what the
    // rest of this crate uses nor what a number parser expects.
    #[test]
    fn reads_the_time_it_arrived() {
        let m = parse_message(MESSAGE).expect("fixture parses");
        assert_eq!(m.received_ms, 1_788_080_000_000);
    }

    #[test]
    fn survives_a_message_with_almost_no_headers() {
        let json = r#"{"id":"x","threadId":"x","internalDate":"0","payload":{"headers":[]}}"#;
        let m = parse_message(json).expect("parses");
        assert_eq!(m.subject, "(no subject)");
        assert_eq!(m.from_name, "(unknown sender)");
        assert!(!m.unread);
    }

    #[test]
    fn refuses_a_reply_it_cannot_read() {
        assert!(parse_message("not json").is_err());
        assert!(parse_ids("not json").is_err());
    }

    // ---- urls ----

    #[test]
    fn asks_only_for_the_headers_a_list_needs() {
        let url = message_url("18f0a1");
        assert!(url.contains("/messages/18f0a1"));
        assert!(url.contains("format=metadata"), "the full body is not needed for a list");
        for header in ["From", "Subject", "Date"] {
            assert!(url.contains(&format!("metadataHeaders={header}")), "missing {header}");
        }
    }

    #[test]
    fn lists_the_inbox_by_default() {
        let url = list_url(20, None);
        assert!(url.contains("labelIds=INBOX"));
        assert!(url.contains("maxResults=20"));
    }

    // A query reaches a URL, so a search for "a b" or "from:x&y" must not end
    // the value early.
    #[test]
    fn escapes_a_search_before_it_reaches_a_url() {
        let url = list_url(20, Some("is:unread from:a b&c"));
        assert!(!url.split("q=").nth(1).unwrap().split('&').next().unwrap().contains(' '));
        assert!(url.contains("q="));
    }

    // A message id goes into the path. Anything that could climb out of it is
    // refused rather than escaped, because no real id contains those.
    #[test]
    fn refuses_a_message_id_that_is_not_one() {
        assert!(safe_id("18f0a1"));
        assert!(!safe_id("../../users/someone-else"));
        assert!(!safe_id("18f0a1?alt=media"));
        assert!(!safe_id(""));
        assert!(!safe_id(&"a".repeat(200)));
    }

    #[test]
    fn only_connection_failures_and_server_faults_are_worth_retrying() {
        assert!(GmailError::Network("refused".into()).is_transient());
        assert!(GmailError::Upstream(503).is_transient());
        assert!(!GmailError::Upstream(401).is_transient());
        assert!(!GmailError::Malformed("bad".into()).is_transient());
    }
}
