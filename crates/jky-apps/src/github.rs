//! GitHub, over the device authorization grant.
//!
//! Device flow rather than the authorization-code flow, for two reasons that
//! both matter here. It needs no redirect URI and no local HTTP server to
//! catch one, which is a whole component this app does not have to grow. And
//! it has no client secret at all — the client id is public by design — so
//! nothing confidential ships in a binary that anyone can download and read.
//!
//! The shape is: ask GitHub for a pair of codes, show the person the short one
//! and where to type it, then poll until they have approved it. The approval
//! happens on github.com under their own two-factor settings, which is where
//! phone approval comes from: this app never sees a password, a one-time code
//! or a push notification.
//!
//! The token that comes back is written straight to the OS keychain by Rust.
//! No IPC command returns it, and the window is only ever told whether one
//! exists — the same rule the Anthropic key follows, one step stricter,
//! because here the window never even types it in.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
pub const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API: &str = "https://api.github.com";

/// The reach this app asks for, pinned by a test.
///
/// `repo` to see private repositories the person owns, `read:org` so
/// organisation repositories appear at all, and `notifications` for the
/// unread list. Nothing that writes, nothing administrative, and no
/// `delete_repo` — a terminal that can read your work does not need to be
/// able to destroy it.
pub const SCOPES: &str = "repo read:org notifications";

/// The key the token is stored under in the OS keychain.
pub const TOKEN_KEY: &str = "github-token";

/// The OAuth app this build signs in against.
///
/// Committed on purpose. A device-flow client id is public by design — it
/// identifies the application, not a person, and there is no client secret
/// beside it to protect. GitHub's own documentation treats it as public, and
/// every installed app that uses this grant ships one the same way.
///
/// Shipping it is what makes the app usable by someone who has just
/// downloaded it: without a default they would have to register an OAuth app
/// of their own before they could sign in, which is a barrier no one should
/// have to clear to look at their own repositories.
///
/// A stored id still wins over this one, so anyone who prefers to run against
/// their own OAuth app can.
pub const DEFAULT_CLIENT_ID: &str = "Ov23limHyY7cMtiFBf9c";

#[derive(Debug, Error)]
pub enum GitHubError {
    #[error("GitHub sent a reply this could not read: {0}")]
    Malformed(String),
    #[error("could not reach GitHub: {0}")]
    Network(String),
    #[error("GitHub answered with status {0}")]
    Upstream(u16),
    #[error("GitHub refused the sign-in: {0}")]
    Refused(String),
}

impl GitHubError {
    /// Whether trying again is worth doing. Same rule as everywhere else in
    /// this crate: a dropped connection is a blip, an answer is an answer,
    /// and a 5xx says the far side broke rather than that we asked wrongly.
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Network(_) => true,
            Self::Upstream(status) => *status >= 500,
            _ => false,
        }
    }
}

/// What the person has to do, and nothing else.
///
/// Deliberately does not carry the device code. That is the credential which
/// redeems the token, it stays in Rust for the length of the flow, and a test
/// asserts it never appears in this struct's serialised form.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeviceStart {
    /// The short code a person types on github.com.
    pub user_code: String,
    pub verification_uri: String,
    /// How often GitHub permits polling.
    pub interval_s: u64,
    /// How long the code is good for.
    pub expires_in_s: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PollOutcome {
    /// Not approved yet. The normal answer for most of the flow.
    Pending,
    /// Polled too fast; wait this long instead of the original interval.
    SlowDown { interval_s: u64 },
    Ready(String),
    Denied,
    Expired,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Repo {
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub stars: u32,
    pub open_issues: u32,
    pub updated_at: String,
}

/// An issue or a pull request. GitHub's search returns both in one list.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Item {
    pub number: u64,
    pub title: String,
    pub html_url: String,
    pub state: String,
    /// "owner/name", derived from the API url the search returns.
    pub repo: Option<String>,
    pub is_pull_request: bool,
    pub draft: bool,
}

// ---- the wire ----

#[derive(Deserialize)]
struct WireStart {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct WirePoll {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct WireRepo {
    name: String,
    full_name: String,
    private: bool,
    html_url: String,
    description: Option<String>,
    language: Option<String>,
    #[serde(default)]
    stargazers_count: u32,
    #[serde(default)]
    open_issues_count: u32,
    #[serde(default)]
    updated_at: String,
}

#[derive(Deserialize)]
struct WireSearch {
    #[serde(default)]
    items: Vec<WireItem>,
}

#[derive(Deserialize)]
struct WireItem {
    number: u64,
    title: String,
    html_url: String,
    state: String,
    repository_url: Option<String>,
    /// Present only on pull requests; its contents are not needed.
    pull_request: Option<serde_json::Value>,
    #[serde(default)]
    draft: bool,
}

// ---- parsing ----

/// The pair of codes, split into what the window may see and what it may not.
pub fn parse_device_start(json: &str) -> Result<(DeviceStart, String), GitHubError> {
    let wire: WireStart =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    Ok((
        DeviceStart {
            user_code: wire.user_code,
            verification_uri: wire.verification_uri,
            interval_s: wire.interval,
            expires_in_s: wire.expires_in,
        },
        wire.device_code,
    ))
}

/// Where one poll got to.
///
/// GitHub answers HTTP 200 with an `error` field for every stage of the wait,
/// so the status code says nothing and the body says everything.
pub fn parse_poll(json: &str) -> Result<PollOutcome, GitHubError> {
    let wire: WirePoll =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    if let Some(token) = wire.access_token.filter(|t| !t.is_empty()) {
        return Ok(PollOutcome::Ready(token));
    }

    Ok(match wire.error.as_deref() {
        Some("authorization_pending") => PollOutcome::Pending,
        // The interval GitHub asks for, or one second more than the default
        // if it did not say: polling at the old rate is refused again.
        Some("slow_down") => PollOutcome::SlowDown {
            interval_s: wire.interval.unwrap_or(10),
        },
        Some("access_denied") => PollOutcome::Denied,
        Some("expired_token") => PollOutcome::Expired,
        // Anything undocumented ends the attempt rather than looking like
        // "keep waiting", which would poll until the code expired.
        Some(other) => return Err(GitHubError::Refused(other.to_string())),
        None => return Err(GitHubError::Malformed("no token and no error".into())),
    })
}

pub fn parse_repos(json: &str) -> Result<Vec<Repo>, GitHubError> {
    let wire: Vec<WireRepo> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;
    Ok(wire
        .into_iter()
        .map(|r| Repo {
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            html_url: r.html_url,
            description: r.description,
            language: r.language,
            stars: r.stargazers_count,
            open_issues: r.open_issues_count,
            updated_at: r.updated_at,
        })
        .collect())
}

pub fn parse_items(json: &str) -> Result<Vec<Item>, GitHubError> {
    let wire: WireSearch =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;
    Ok(wire
        .items
        .into_iter()
        .map(|i| Item {
            number: i.number,
            title: i.title,
            html_url: i.html_url,
            state: i.state,
            repo: i.repository_url.as_deref().and_then(short_repo),
            is_pull_request: i.pull_request.is_some(),
            draft: i.draft,
        })
        .collect())
}

/// "https://api.github.com/repos/owner/name" -> "owner/name".
///
/// The search result names the repository only as an API url, and "owner/name"
/// is what a person recognises.
fn short_repo(api_url: &str) -> Option<String> {
    let rest = api_url.split("/repos/").nth(1)?;
    (!rest.is_empty()).then(|| rest.to_string())
}

// ---- urls ----

/// Percent-encode one query-string value. The same hand-rolled encoder the
/// place search uses, and for the same reason: a dozen lines rather than
/// another crate in a tree the project audits.
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

pub fn search_url(query: &str) -> String {
    format!("{API}/search/issues?q={}&per_page=20&sort=updated", encode(query))
}

pub fn user_url() -> String {
    format!("{API}/user")
}

pub fn repos_url() -> String {
    format!("{API}/user/repos?per_page=20&sort=updated&affiliation=owner,collaborator")
}

// ---- the dashboard ----

/// The account, with the counts the overview tiles show.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Profile {
    pub login: String,
    pub name: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: String,
    pub public_repos: u32,
    pub followers: u32,
    pub following: u32,
}

/// One line of the activity feed, already turned into words.
///
/// The verb and the detail are split so the row can set them differently, and
/// so a feed never has to parse an event type in the frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Activity {
    pub id: String,
    /// "Pushed to", "Opened PR", "Merged PR", "Starred", …
    pub verb: String,
    pub repo: String,
    /// The branch, the title, whatever the verb needs beside it.
    pub detail: String,
    pub html_url: String,
    pub at: String,
}

/// One day in the contribution calendar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ContribDay {
    pub date: String,
    pub count: u32,
    /// 0–4, graded against the busiest day of the year.
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Contributions {
    pub total: u32,
    /// Weeks of seven days, oldest first — the shape the heatmap draws.
    pub weeks: Vec<Vec<ContribDay>>,
}

#[derive(Deserialize)]
struct WireProfile {
    login: String,
    name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    public_repos: u32,
    #[serde(default)]
    followers: u32,
    #[serde(default)]
    following: u32,
}

#[derive(Deserialize)]
struct WireEvent {
    id: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    created_at: String,
    repo: Option<WireEventRepo>,
    payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct WireEventRepo {
    #[serde(default)]
    name: String,
}

pub fn parse_profile(json: &str) -> Result<Profile, GitHubError> {
    let wire: WireProfile =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;
    Ok(Profile {
        login: wire.login,
        name: wire.name,
        bio: wire.bio,
        avatar_url: wire.avatar_url,
        html_url: wire.html_url,
        public_repos: wire.public_repos,
        followers: wire.followers,
        following: wire.following,
    })
}

/// The event feed, as sentences.
///
/// The translation happens here rather than in the window so there is one
/// place that knows GitHub's event vocabulary. An event type this build has
/// never seen is dropped: GitHub adds them, and a blank row saying nothing is
/// worse than one fewer row.
pub fn parse_activity(json: &str) -> Result<Vec<Activity>, GitHubError> {
    let wire: Vec<WireEvent> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    Ok(wire.into_iter().filter_map(describe_event).collect())
}

fn describe_event(e: WireEvent) -> Option<Activity> {
    let repo = e.repo.map(|r| r.name).unwrap_or_default();
    let payload = e.payload.unwrap_or(serde_json::Value::Null);
    let text = |path: &[&str]| -> Option<String> {
        let mut node = &payload;
        for key in path {
            node = node.get(key)?;
        }
        node.as_str().map(str::to_string)
    };
    let number = |key: &str| payload.get(key)?.get("number")?.as_u64();
    let repo_url = format!("https://github.com/{repo}");

    let (verb, detail, url) = match e.kind.as_deref()? {
        "PushEvent" => {
            // A large push arrives with its commits truncated away, so the
            // branch is what the row can always say.
            let branch = text(&["ref"])
                .map(|r| r.trim_start_matches("refs/heads/").to_string())
                .unwrap_or_default();
            ("Pushed to", branch, repo_url.clone())
        }
        "PullRequestEvent" => {
            let merged = payload
                .get("pull_request")
                .and_then(|p| p.get("merged"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let action = text(&["action"]).unwrap_or_default();
            let verb = match (action.as_str(), merged) {
                (_, true) => "Merged PR",
                ("closed", false) => "Closed PR",
                ("opened", _) | ("reopened", _) => "Opened PR",
                _ => "Updated PR",
            };
            let title = text(&["pull_request", "title"]).unwrap_or_default();
            let url = text(&["pull_request", "html_url"]).unwrap_or_else(|| {
                number("pull_request")
                    .map(|n| format!("{repo_url}/pull/{n}"))
                    .unwrap_or_else(|| repo_url.clone())
            });
            (verb, title, url)
        }
        "IssuesEvent" => {
            let verb = match text(&["action"]).unwrap_or_default().as_str() {
                "closed" => "Closed issue",
                "reopened" => "Reopened issue",
                _ => "Opened issue",
            };
            let title = text(&["issue", "title"]).unwrap_or_default();
            let url = text(&["issue", "html_url"]).unwrap_or_else(|| repo_url.clone());
            (verb, title, url)
        }
        "IssueCommentEvent" => {
            let title = text(&["issue", "title"]).unwrap_or_default();
            let url = text(&["comment", "html_url"]).unwrap_or_else(|| repo_url.clone());
            ("Commented on", title, url)
        }
        "WatchEvent" => ("Starred", String::new(), repo_url.clone()),
        "ForkEvent" => ("Forked", String::new(), repo_url.clone()),
        "CreateEvent" => {
            let what = text(&["ref_type"]).unwrap_or_default();
            let name = text(&["ref"]).unwrap_or_default();
            let verb = if what == "branch" {
                "Created branch"
            } else if what == "tag" {
                "Created tag"
            } else {
                "Created repository"
            };
            (verb, name, repo_url.clone())
        }
        "ReleaseEvent" => {
            let name = text(&["release", "tag_name"]).unwrap_or_default();
            let url = text(&["release", "html_url"]).unwrap_or_else(|| repo_url.clone());
            ("Released", name, url)
        }
        // Unknown to this build. GitHub keeps adding types, and one fewer row
        // is better than a row that says nothing.
        _ => return None,
    };

    Some(Activity {
        id: e.id,
        verb: verb.to_string(),
        repo,
        detail,
        html_url: url,
        at: e.created_at,
    })
}

/// The contribution calendar, which only GraphQL has.
///
/// REST publishes no endpoint for it — the heatmap on a GitHub profile is not
/// reachable any other way — so this is the one call in the crate that speaks
/// GraphQL.
pub fn contributions_query() -> String {
    "{\"query\":\"{ viewer { contributionsCollection { contributionCalendar { \
     totalContributions weeks { contributionDays { date contributionCount } } } } } }\"}"
        .to_string()
}

pub fn parse_contributions(json: &str) -> Result<Contributions, GitHubError> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    // GraphQL answers 200 with an `errors` array, so the status says nothing
    // and a caller that only checked it would draw an empty year.
    if let Some(errors) = root.get("errors").and_then(|e| e.as_array()) {
        let first = errors
            .first()
            .and_then(|e| e.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("GraphQL refused the query");
        return Err(GitHubError::Refused(first.to_string()));
    }

    let calendar = root
        .pointer("/data/viewer/contributionsCollection/contributionCalendar")
        .ok_or_else(|| GitHubError::Malformed("no contribution calendar in the reply".into()))?;

    let total = calendar
        .get("totalContributions")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as u32;

    let raw: Vec<Vec<(String, u32)>> = calendar
        .get("weeks")
        .and_then(serde_json::Value::as_array)
        .map(|weeks| {
            weeks
                .iter()
                .map(|w| {
                    w.get("contributionDays")
                        .and_then(serde_json::Value::as_array)
                        .map(|days| {
                            days.iter()
                                .map(|d| {
                                    (
                                        d.get("date")
                                            .and_then(serde_json::Value::as_str)
                                            .unwrap_or_default()
                                            .to_string(),
                                        d.get("contributionCount")
                                            .and_then(serde_json::Value::as_u64)
                                            .unwrap_or(0) as u32,
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default();

    // Graded against the busiest day rather than fixed thresholds, so a quiet
    // year still shows its own shape instead of rendering as a blank grid.
    let busiest = raw
        .iter()
        .flatten()
        .map(|(_, count)| *count)
        .max()
        .unwrap_or(0);

    let weeks = raw
        .into_iter()
        .map(|week| {
            week.into_iter()
                .map(|(date, count)| ContribDay {
                    level: level_for(count, busiest),
                    date,
                    count,
                })
                .collect()
        })
        .collect();

    Ok(Contributions { total, weeks })
}

/// 0 for nothing, then four bands up to the busiest day.
fn level_for(count: u32, busiest: u32) -> u8 {
    if count == 0 || busiest == 0 {
        return 0;
    }
    let share = count as f64 / busiest as f64;
    match share {
        s if s > 0.75 => 4,
        s if s > 0.5 => 3,
        s if s > 0.25 => 2,
        _ => 1,
    }
}

// ---- browsing a repository ----

/// One row in a directory listing.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub html_url: String,
}

/// A file's contents, or the reason there are none to show.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileContent {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub html_url: String,
    /// The text, when it is text and small enough to have been sent.
    pub text: Option<String>,
    /// Not text. Rendering it would be a screenful of replacement characters.
    pub is_binary: bool,
    /// Past a megabyte the contents API sends no content at all.
    pub too_large: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Commit {
    pub sha: String,
    pub short_sha: String,
    /// The first line of the message. The body belongs on the commit page.
    pub subject: String,
    pub author: String,
    pub date: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Branch {
    pub name: String,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Notification {
    pub id: String,
    pub title: String,
    /// Why this is in front of you: "mention", "review requested", …
    pub reason: String,
    /// "Issue", "PullRequest", "Release", …
    pub kind: String,
    pub repo: String,
    pub unread: bool,
    pub updated_at: String,
    /// Somewhere a browser can actually open, built from the repo and number.
    pub html_url: String,
}

#[derive(Deserialize)]
struct WireEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    html_url: String,
}

#[derive(Deserialize)]
struct WireFile {
    name: String,
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    encoding: String,
}

#[derive(Deserialize)]
struct WireCommit {
    sha: String,
    #[serde(default)]
    html_url: String,
    commit: WireCommitBody,
    author: Option<WireLogin>,
}

#[derive(Deserialize)]
struct WireCommitBody {
    #[serde(default)]
    message: String,
    author: Option<WireGitAuthor>,
}

#[derive(Deserialize)]
struct WireGitAuthor {
    #[serde(default)]
    name: String,
    #[serde(default)]
    date: String,
}

#[derive(Deserialize)]
struct WireLogin {
    login: String,
}

#[derive(Deserialize)]
struct WireBranch {
    name: String,
    #[serde(default)]
    protected: bool,
}

#[derive(Deserialize)]
struct WireNotification {
    id: String,
    #[serde(default)]
    unread: bool,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    updated_at: String,
    subject: WireSubject,
    repository: WireNotificationRepo,
}

#[derive(Deserialize)]
struct WireSubject {
    #[serde(default)]
    title: String,
    url: Option<String>,
    #[serde(rename = "type", default)]
    kind: String,
}

#[derive(Deserialize)]
struct WireNotificationRepo {
    #[serde(default)]
    full_name: String,
}

/// A directory listing, folders first and then by name.
///
/// The API returns its own order, which puts directories among the files.
/// Every file browser a person has used groups them, so this does too, and
/// the comparison ignores case because "Apple" sorting after "banana" reads
/// as a bug rather than as ASCII.
pub fn parse_entries(json: &str) -> Result<Vec<Entry>, GitHubError> {
    let wire: Vec<WireEntry> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    let mut entries: Vec<Entry> = wire
        .into_iter()
        .map(|e| Entry {
            is_dir: e.kind == "dir",
            name: e.name,
            path: e.path,
            size: e.size,
            html_url: e.html_url,
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// One file, decoded when there is anything to decode.
///
/// Three outcomes rather than one: text, binary, and too large. They look the
/// same on the wire — no usable content — and mean different things to whoever
/// is looking at the panel.
pub fn parse_file(json: &str) -> Result<FileContent, GitHubError> {
    let wire: WireFile =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    // Past a megabyte the contents API sends no content and says so by
    // setting the encoding to "none".
    let too_large = wire.encoding == "none" || (wire.content.trim().is_empty() && wire.size > 0);

    let decoded = if too_large || wire.encoding != "base64" {
        None
    } else {
        // GitHub wraps its base64 at sixty columns; the decoder is given the
        // payload with the newlines taken out.
        let joined: String = wire.content.split_whitespace().collect();
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(joined.as_bytes())
            .ok()
    };

    let (text, is_binary) = match decoded {
        None => (None, false),
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) => (Some(text), false),
            // Not UTF-8, so not something to render as text. Showing it would
            // fill the panel with replacement characters and read as
            // corruption rather than as a picture.
            Err(_) => (None, true),
        },
    };

    Ok(FileContent {
        name: wire.name,
        path: wire.path,
        size: wire.size,
        html_url: wire.html_url,
        text,
        is_binary,
        too_large,
    })
}

pub fn parse_commits(json: &str) -> Result<Vec<Commit>, GitHubError> {
    let wire: Vec<WireCommit> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    Ok(wire
        .into_iter()
        .map(|c| {
            let git_author = c.commit.author.unwrap_or(WireGitAuthor {
                name: String::new(),
                date: String::new(),
            });
            Commit {
                short_sha: c.sha.chars().take(7).collect(),
                sha: c.sha,
                // The subject only. A body pasted into a row makes every row a
                // different height and buries the next commit.
                subject: c.commit.message.lines().next().unwrap_or_default().to_string(),
                // A commit from an address with no GitHub account has a null
                // `author`, and the name has to come from the commit itself.
                author: c
                    .author
                    .map(|a| a.login)
                    .filter(|l| !l.is_empty())
                    .unwrap_or(git_author.name),
                date: git_author.date,
                html_url: c.html_url,
            }
        })
        .collect())
}

pub fn parse_branches(json: &str) -> Result<Vec<Branch>, GitHubError> {
    let wire: Vec<WireBranch> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;
    Ok(wire
        .into_iter()
        .map(|b| Branch {
            name: b.name,
            protected: b.protected,
        })
        .collect())
}

pub fn parse_notifications(json: &str) -> Result<Vec<Notification>, GitHubError> {
    let wire: Vec<WireNotification> =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;

    Ok(wire
        .into_iter()
        .map(|n| {
            let html_url = browsable(&n.repository.full_name, &n.subject.kind, n.subject.url.as_deref());
            Notification {
                id: n.id,
                title: n.subject.title,
                // "review_requested" is how the API writes it; "review
                // requested" is how it reads in a row.
                reason: n.reason.replace('_', " "),
                kind: n.subject.kind,
                repo: n.repository.full_name,
                unread: n.unread,
                updated_at: n.updated_at,
                html_url,
            }
        })
        .collect())
}

/// A url a browser can open, from the API url a notification carries.
///
/// The subject url points at the API, which is not something a person can
/// follow. The number at the end of it, against the repository, is.
fn browsable(repo: &str, kind: &str, api_url: Option<&str>) -> String {
    let base = format!("https://github.com/{repo}");
    let Some(number) = api_url.and_then(|u| u.rsplit('/').next()).filter(|n| !n.is_empty()) else {
        return base;
    };
    // GitHub's API says "pulls" and its website says "pull".
    let segment = match kind {
        "PullRequest" => "pull",
        "Issue" => "issues",
        "Discussion" => "discussions",
        _ => return base,
    };
    format!("{base}/{segment}/{number}")
}

// ---- urls ----

/// Escape a path for a URL without escaping the separators.
///
/// A filename can contain a space or a hash, either of which would end the
/// path or start a fragment; the slashes between segments must survive.
fn encode_path(path: &str) -> String {
    path.split('/')
        .map(encode)
        .collect::<Vec<_>>()
        .join("/")
}

pub fn contents_url(repo: &str, path: &str) -> String {
    if path.is_empty() {
        format!("{API}/repos/{repo}/contents")
    } else {
        format!("{API}/repos/{repo}/contents/{}", encode_path(path))
    }
}

pub fn commits_url(repo: &str) -> String {
    format!("{API}/repos/{repo}/commits?per_page=20")
}

pub fn branches_url(repo: &str) -> String {
    format!("{API}/repos/{repo}/branches?per_page=30")
}

pub fn notifications_url() -> String {
    format!("{API}/notifications?per_page=20")
}

// ---- fetching ----

/// Everything the dashboard shows, as one panel-load.
///
/// One reply rather than eight round trips from the window: the panel draws
/// all of it at once, and eight separate calls would fill it in eight jerks.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Summary {
    pub user: Profile,
    pub repos: Vec<Repo>,
    /// Open issues assigned to the signed-in person.
    pub issues: Vec<Item>,
    pub pulls: Vec<Item>,
    pub notifications: Vec<Notification>,
    pub activity: Vec<Activity>,
    /// Stars across the repositories they own — what a profile calls "stars".
    pub stars_received: u32,
    /// Absent when GraphQL declined; the rest of the dashboard still draws.
    pub contributions: Option<Contributions>,
}

async fn api_get(client: &reqwest::Client, url: &str, token: &str) -> Result<String, GitHubError> {
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        // GitHub rejects requests with no user agent outright.
        .header("User-Agent", "JKY-Terminal")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(GitHubError::Upstream(status.as_u16()));
    }

    response
        .text()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))
}

/// Begin the flow. Returns what to show, and the device code to keep.
pub async fn start_device(
    client: &reqwest::Client,
    client_id: &str,
) -> Result<(DeviceStart, String), GitHubError> {
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || async {
        let response = client
            .post(DEVICE_CODE_URL)
            .header("Accept", "application/json")
            .form(&[("client_id", client_id), ("scope", SCOPES)])
            .send()
            .await
            .map_err(|e| GitHubError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(GitHubError::Upstream(status.as_u16()));
        }
        response
            .text()
            .await
            .map_err(|e| GitHubError::Network(e.to_string()))
    })
    .await?;

    parse_device_start(&body)
}

/// Ask once whether the person has approved yet.
///
/// Not retried: polling is already a loop on a schedule GitHub dictates, and
/// a retry inside one tick would only poll faster than it permits.
pub async fn poll_once(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
) -> Result<PollOutcome, GitHubError> {
    let response = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(GitHubError::Upstream(status.as_u16()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))?;

    parse_poll(&body)
}

/// Everything the panel shows, in one pass.
///
/// The account has to load or there is nothing to show. The three lists do
/// not: a search that fails costs its own section rather than the panel, the
/// same rule the news app follows.
pub async fn fetch_summary(client: &reqwest::Client, token: &str) -> Result<Summary, GitHubError> {
    // Bound before the closure: a temporary built inside it would be dropped
    // while the future it is borrowed by is still alive.
    let account_url = user_url();
    let user_body =
        crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
            api_get(client, &account_url, token)
        })
        .await?;
    let user = parse_profile(&user_body)?;

    let repos_url = repos_url();
    let issues_url = search_url("is:open is:issue assignee:@me archived:false");
    let pulls_url = search_url("is:open is:pr author:@me archived:false");
    let events_url = format!("{API}/users/{}/events?per_page=20", encode(&user.login));
    let notes_url = notifications_url();

    // Everything at once. Each section fails to an empty list rather than
    // taking the dashboard with it — the same rule the news app follows.
    let (repos, issues, pulls, notifications, activity, contributions) = tokio::join!(
        async {
            api_get(client, &repos_url, token)
                .await
                .ok()
                .and_then(|b| parse_repos(&b).ok())
                .unwrap_or_default()
        },
        async {
            api_get(client, &issues_url, token)
                .await
                .ok()
                .and_then(|b| parse_items(&b).ok())
                .unwrap_or_default()
        },
        async {
            api_get(client, &pulls_url, token)
                .await
                .ok()
                .and_then(|b| parse_items(&b).ok())
                .unwrap_or_default()
        },
        async {
            api_get(client, &notes_url, token)
                .await
                .ok()
                .and_then(|b| parse_notifications(&b).ok())
                .unwrap_or_default()
        },
        async {
            api_get(client, &events_url, token)
                .await
                .ok()
                .and_then(|b| parse_activity(&b).ok())
                .unwrap_or_default()
        },
        async { fetch_contributions(client, token).await.ok() }
    );

    // What a profile page calls "stars": the ones other people gave you.
    let stars_received = repos.iter().map(|r| r.stars).sum();

    Ok(Summary {
        user,
        repos,
        issues,
        pulls,
        notifications,
        activity,
        stars_received,
        contributions,
    })
}

/// The contribution calendar, over GraphQL.
///
/// The one call in this crate that is not REST, because REST publishes no
/// endpoint for it. Not retried: it is optional to the dashboard, and a
/// failure costs the heatmap rather than the page.
pub async fn fetch_contributions(
    client: &reqwest::Client,
    token: &str,
) -> Result<Contributions, GitHubError> {
    let response = client
        .post(format!("{API}/graphql"))
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "JKY-Terminal")
        .header("Content-Type", "application/json")
        .body(contributions_query())
        .send()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(GitHubError::Upstream(status.as_u16()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| GitHubError::Network(e.to_string()))?;

    parse_contributions(&body)
}

/// One repository's tree at a path. An empty path is the root.
pub async fn fetch_entries(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    path: &str,
) -> Result<Vec<Entry>, GitHubError> {
    let url = contents_url(repo, path);
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
        api_get(client, &url, token)
    })
    .await?;
    parse_entries(&body)
}

pub async fn fetch_file(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    path: &str,
) -> Result<FileContent, GitHubError> {
    let url = contents_url(repo, path);
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
        api_get(client, &url, token)
    })
    .await?;
    parse_file(&body)
}

pub async fn fetch_commits(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
) -> Result<Vec<Commit>, GitHubError> {
    let url = commits_url(repo);
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
        api_get(client, &url, token)
    })
    .await?;
    parse_commits(&body)
}

pub async fn fetch_branches(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
) -> Result<Vec<Branch>, GitHubError> {
    let url = branches_url(repo);
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
        api_get(client, &url, token)
    })
    .await?;
    parse_branches(&body)
}

pub async fn fetch_notifications(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<Notification>, GitHubError> {
    let url = notifications_url();
    let body = crate::net::retrying(crate::net::ATTEMPTS, GitHubError::is_transient, || {
        api_get(client, &url, token)
    })
    .await?;
    parse_notifications(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = include_str!("../fixtures/gh-device-start.json");
    const TOKEN: &str = include_str!("../fixtures/gh-device-token.json");
    const USER: &str = include_str!("../fixtures/gh-user.json");
    const REPOS: &str = include_str!("../fixtures/gh-repos.json");
    const SEARCH: &str = include_str!("../fixtures/gh-search.json");

    // ---- the device flow ----

    #[test]
    fn reads_what_the_person_has_to_do() {
        let (start, _) = parse_device_start(START).expect("fixture parses");
        assert_eq!(start.user_code, "WDJB-MJHT");
        assert_eq!(start.verification_uri, "https://github.com/login/device");
        assert_eq!(start.interval_s, 5);
        assert_eq!(start.expires_in_s, 900);
    }

    #[test]
    fn keeps_the_device_code_separate_from_what_it_shows() {
        let (_, device_code) = parse_device_start(START).expect("fixture parses");
        assert_eq!(device_code, "3584d83530557fdd1f46af8289938c8ef79f9dc5");
    }

    // The device code is the credential that redeems the token. The window
    // gets the short code a person types and the URL to type it at, and
    // nothing else — so a compromised frontend cannot complete the exchange
    // on its own. Serialising is what would leak it, so that is what is
    // checked rather than the struct's shape.
    #[test]
    fn never_serialises_the_device_code_towards_the_window() {
        let (start, device_code) = parse_device_start(START).expect("fixture parses");
        let json = serde_json::to_string(&start).expect("serialises");
        assert!(
            !json.contains(&device_code),
            "SECURITY: the device code reached the window in {json}"
        );
    }

    #[test]
    fn refuses_a_start_reply_it_cannot_read() {
        assert!(parse_device_start("not json").is_err());
        assert!(parse_device_start(r#"{"user_code":"X"}"#).is_err());
    }

    // Polling before the person has approved is the normal case, not an error.
    #[test]
    fn reads_waiting_as_waiting() {
        let json = r#"{"error":"authorization_pending","error_description":"..."}"#;
        assert_eq!(parse_poll(json).expect("parses"), PollOutcome::Pending);
    }

    // GitHub answers slow_down when polled too fast, and says how long to wait.
    // Ignoring the new interval gets the request rejected again.
    #[test]
    fn reads_slow_down_and_the_interval_it_asks_for() {
        let json = r#"{"error":"slow_down","interval":10}"#;
        assert_eq!(parse_poll(json).expect("parses"), PollOutcome::SlowDown { interval_s: 10 });
    }

    #[test]
    fn reads_a_refusal_and_a_timeout_apart() {
        assert_eq!(
            parse_poll(r#"{"error":"access_denied"}"#).expect("parses"),
            PollOutcome::Denied
        );
        assert_eq!(
            parse_poll(r#"{"error":"expired_token"}"#).expect("parses"),
            PollOutcome::Expired
        );
    }

    #[test]
    fn reads_the_token_when_it_finally_arrives() {
        match parse_poll(TOKEN).expect("fixture parses") {
            PollOutcome::Ready(token) => assert!(token.starts_with("gho_")),
            other => panic!("expected a token, got {other:?}"),
        }
    }

    // An error GitHub has not documented is still an end to the attempt. It
    // must not read as "keep polling", which would spin until the code
    // expired and then report the wrong reason.
    #[test]
    fn treats_an_unknown_error_as_a_failure_rather_than_as_waiting() {
        match parse_poll(r#"{"error":"something_new"}"#) {
            Err(GitHubError::Refused(reason)) => assert_eq!(reason, "something_new"),
            other => panic!("an undocumented error should end the flow, got {other:?}"),
        }
    }

    // A reply with neither a token nor an error is not a state the flow has,
    // and treating it as "keep waiting" would poll for ever.
    #[test]
    fn refuses_a_poll_reply_that_says_nothing() {
        assert!(matches!(parse_poll("{}"), Err(GitHubError::Malformed(_))));
    }

    // ---- the account ----

    #[test]
    fn reads_who_is_signed_in() {
        let user = parse_profile(USER).expect("fixture parses");
        assert_eq!(user.login, "octocat");
        assert_eq!(user.name.as_deref(), Some("The Octocat"));
        assert!(user.html_url.starts_with("https://github.com/"));
    }

    #[test]
    fn reads_repositories() {
        let repos = parse_repos(REPOS).expect("fixture parses");
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].full_name, "octocat/Hello-World");
        assert!(!repos[0].private);
        assert!(repos[0].stars > 0);
    }

    // A repository with no description and no language is ordinary, not
    // malformed — most new ones look exactly like that.
    #[test]
    fn reads_a_repository_with_nothing_filled_in() {
        let json = r#"[{"name":"n","full_name":"o/n","private":true,
                        "html_url":"https://github.com/o/n","stargazers_count":0,
                        "open_issues_count":0,"updated_at":"2026-01-01T00:00:00Z"}]"#;
        let repos = parse_repos(json).expect("parses");
        assert_eq!(repos[0].description, None);
        assert_eq!(repos[0].language, None);
        assert!(repos[0].private);
    }

    #[test]
    fn reads_issues_and_pull_requests_from_a_search() {
        let items = parse_items(SEARCH).expect("fixture parses");
        assert_eq!(items.len(), 2);
        assert!(items[0].number > 0);
        assert!(!items[0].title.is_empty());
    }

    // The search endpoint returns both in one list, and the only thing that
    // tells them apart is whether a `pull_request` key is present.
    #[test]
    fn tells_a_pull_request_from_an_issue() {
        let items = parse_items(SEARCH).expect("fixture parses");
        assert!(items.iter().all(|i| i.is_pull_request));

        let issue = r#"{"total_count":1,"items":[{"number":1,"title":"t","state":"open",
            "html_url":"https://github.com/o/r/issues/1",
            "repository_url":"https://api.github.com/repos/o/r"}]}"#;
        assert!(!parse_items(issue).expect("parses")[0].is_pull_request);
    }

    // The search result names the repo only as an API URL, and "o/r" is what
    // a person recognises.
    #[test]
    fn names_the_repository_the_way_a_person_writes_it() {
        let json = r#"{"total_count":1,"items":[{"number":1,"title":"t","state":"open",
            "html_url":"https://github.com/o/r/issues/1",
            "repository_url":"https://api.github.com/repos/octocat/Hello-World"}]}"#;
        assert_eq!(parse_items(json).expect("parses")[0].repo.as_deref(), Some("octocat/Hello-World"));
    }

    #[test]
    fn reads_an_empty_search_as_nothing_found() {
        assert!(parse_items(r#"{"total_count":0,"items":[]}"#).expect("parses").is_empty());
    }

    // ---- urls and transience ----

    #[test]
    fn builds_the_urls_it_calls() {
        assert_eq!(DEVICE_CODE_URL, "https://github.com/login/device/code");
        assert_eq!(ACCESS_TOKEN_URL, "https://github.com/login/oauth/access_token");
        assert!(search_url("is:open").starts_with("https://api.github.com/search/issues?q="));
    }

    #[test]
    fn escapes_a_search_query_before_it_reaches_a_url() {
        let url = search_url("is:pr author:@me repo:a/b");
        assert!(!url.contains(' '));
        assert!(url.contains("%20") || url.contains("+"));
    }

    #[test]
    fn only_connection_failures_and_server_faults_are_worth_retrying() {
        assert!(GitHubError::Network("refused".into()).is_transient());
        assert!(GitHubError::Upstream(502).is_transient());
        assert!(!GitHubError::Upstream(401).is_transient());
        assert!(!GitHubError::Malformed("bad".into()).is_transient());
    }

    // The scopes are the app's reach into someone's account. Widening them is
    // a decision, so the set is pinned rather than assembled at a call site.
    #[test]
    fn asks_for_the_narrowest_useful_scopes() {
        assert_eq!(SCOPES, "repo read:org notifications");
        assert!(!SCOPES.contains("admin"));
        assert!(!SCOPES.contains("delete"));
        assert!(!SCOPES.contains("write:org"));
    }
}

#[cfg(test)]
mod default_client_tests {
    use super::*;

    // A new install has to be able to sign in without registering anything.
    #[test]
    fn a_client_id_ships_with_the_app() {
        assert!(!DEFAULT_CLIENT_ID.is_empty());
    }

    // The id is public; a secret is not. Nothing that looks like one belongs
    // in this file, and the shape check is the cheap way to keep it that way.
    #[test]
    fn what_ships_is_an_id_and_not_a_secret() {
        assert!(DEFAULT_CLIENT_ID.starts_with("Ov23li") || DEFAULT_CLIENT_ID.len() == 20);
        assert!(DEFAULT_CLIENT_ID.chars().all(|c| c.is_ascii_alphanumeric()));
        // GitHub client secrets are 40 hex characters. Nothing that long and
        // hex-shaped should ever appear here.
        assert!(DEFAULT_CLIENT_ID.len() < 40);
    }
}

#[cfg(test)]
mod browse_tests {
    use super::*;

    const DIR: &str = include_str!("../fixtures/gh-contents-dir.json");
    const FILE: &str = include_str!("../fixtures/gh-file.json");
    const BINARY: &str = include_str!("../fixtures/gh-file-binary.json");
    const COMMITS: &str = include_str!("../fixtures/gh-commits.json");
    const BRANCHES: &str = include_str!("../fixtures/gh-branches.json");
    const NOTIFICATIONS: &str = include_str!("../fixtures/gh-notifications.json");

    // ---- browsing a tree ----

    #[test]
    fn reads_a_directory_listing() {
        let entries = parse_entries(DIR).expect("fixture parses");
        assert_eq!(entries.len(), 3);
        // Sorted, so the directory leads and the files follow by name:
        // src, Cargo.toml, README.md.
        assert_eq!(entries[0].name, "src");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "Cargo.toml");
        assert!(!entries[1].is_dir);
        assert_eq!(entries[2].name, "README.md");
        assert_eq!(entries[2].size, 1284);
    }

    // A file browser that lists in API order puts directories among the files.
    // Folders first, then alphabetical, is what every file browser does.
    #[test]
    fn sorts_folders_first_then_by_name() {
        let json = r#"[
          {"name":"zeta.txt","path":"zeta.txt","type":"file","size":1,"html_url":"h"},
          {"name":"alpha.txt","path":"alpha.txt","type":"file","size":1,"html_url":"h"},
          {"name":"zebra","path":"zebra","type":"dir","size":0,"html_url":"h"},
          {"name":"apple","path":"apple","type":"dir","size":0,"html_url":"h"}
        ]"#;
        let names: Vec<String> = parse_entries(json)
            .expect("parses")
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, ["apple", "zebra", "alpha.txt", "zeta.txt"]);
    }

    #[test]
    fn sorts_names_without_regard_to_case() {
        let json = r#"[
          {"name":"banana","path":"b","type":"file","size":1,"html_url":"h"},
          {"name":"Apple","path":"a","type":"file","size":1,"html_url":"h"}
        ]"#;
        let names: Vec<String> = parse_entries(json)
            .expect("parses")
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, ["Apple", "banana"]);
    }

    #[test]
    fn refuses_a_listing_it_cannot_read() {
        assert!(parse_entries("not json").is_err());
    }

    // ---- reading a file ----

    #[test]
    fn decodes_a_files_contents() {
        let file = parse_file(FILE).expect("fixture parses");
        assert_eq!(file.name, "README.md");
        assert!(file.text.as_deref().unwrap().starts_with("# Hello"));
    }

    // GitHub wraps its base64 at sixty columns. A decoder that does not strip
    // the newlines fails on every file larger than a line.
    #[test]
    fn copes_with_base64_wrapped_across_lines() {
        let file = parse_file(FILE).expect("fixture parses");
        assert!(file.text.as_deref().unwrap().contains("café"), "UTF-8 survived");
    }

    // Rendering a PNG as text produces a screen of replacement characters and
    // looks like corruption rather than a picture.
    #[test]
    fn refuses_to_show_a_binary_file_as_text() {
        let file = parse_file(BINARY).expect("fixture parses");
        assert_eq!(file.text, None);
        assert!(file.is_binary);
        assert_eq!(file.name, "icon.png");
    }

    // The contents API sends no `content` at all past a megabyte, and a file
    // that arrives empty is not the same as an empty file.
    #[test]
    fn says_when_a_file_was_too_large_to_send() {
        let json = r#"{"name":"big.bin","path":"big.bin","size":2000000,
                       "html_url":"h","type":"file","content":"","encoding":"none"}"#;
        let file = parse_file(json).expect("parses");
        assert_eq!(file.text, None);
        assert!(file.too_large);
    }

    #[test]
    fn reads_a_genuinely_empty_file_as_empty_rather_than_missing() {
        let json = r#"{"name":"empty","path":"empty","size":0,"html_url":"h",
                       "type":"file","content":"","encoding":"base64"}"#;
        let file = parse_file(json).expect("parses");
        assert_eq!(file.text.as_deref(), Some(""));
        assert!(!file.too_large);
        assert!(!file.is_binary);
    }

    // ---- history ----

    #[test]
    fn reads_commits() {
        let commits = parse_commits(COMMITS).expect("fixture parses");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].short_sha, "9f6aaa2");
        assert_eq!(commits[0].author, "kartikeyajay2006");
    }

    // A list of commits wants the subject line. The body belongs on the commit
    // page, and pasting it into a row makes every row a different height.
    #[test]
    fn shows_only_the_subject_line_of_a_commit_message() {
        let commits = parse_commits(COMMITS).expect("fixture parses");
        assert_eq!(commits[0].subject, "feat(apps): a thing");
        assert!(!commits[0].subject.contains("body"));
    }

    // A commit from an email address with no GitHub account has a null
    // `author`, and the name has to come from the commit itself.
    #[test]
    fn names_a_committer_who_has_no_github_account() {
        let commits = parse_commits(COMMITS).expect("fixture parses");
        assert_eq!(commits[1].author, "Someone Else");
    }

    #[test]
    fn reads_branches_and_says_which_are_protected() {
        let branches = parse_branches(BRANCHES).expect("fixture parses");
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].protected);
        assert!(!branches[1].protected);
    }

    // ---- notifications ----

    #[test]
    fn reads_notifications() {
        let items = parse_notifications(NOTIFICATIONS).expect("fixture parses");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Something needs your eyes");
        assert_eq!(items[0].repo, "octocat/Hello-World");
        assert!(items[0].unread);
        assert!(!items[1].unread);
    }

    // "mention" and "review_requested" say why this is in front of you, which
    // is the most useful word in the row.
    #[test]
    fn keeps_the_reason_in_words_a_person_reads() {
        let items = parse_notifications(NOTIFICATIONS).expect("fixture parses");
        assert_eq!(items[0].reason, "mention");
        assert_eq!(items[1].reason, "review requested");
    }

    // The API url is not something a person can open. The number at the end of
    // it, against the repository, is.
    #[test]
    fn turns_the_api_url_into_one_that_opens_in_a_browser() {
        let items = parse_notifications(NOTIFICATIONS).expect("fixture parses");
        assert_eq!(
            items[0].html_url,
            "https://github.com/octocat/Hello-World/issues/12"
        );
        assert_eq!(
            items[1].html_url,
            "https://github.com/octocat/Spoon-Knife/pull/34"
        );
    }

    // ---- urls ----

    #[test]
    fn builds_the_browsing_urls() {
        assert_eq!(
            contents_url("octocat/Hello-World", ""),
            "https://api.github.com/repos/octocat/Hello-World/contents"
        );
        assert_eq!(
            contents_url("octocat/Hello-World", "src/main.rs"),
            "https://api.github.com/repos/octocat/Hello-World/contents/src/main.rs"
        );
        assert!(commits_url("o/r").contains("/repos/o/r/commits"));
        assert!(branches_url("o/r").contains("/repos/o/r/branches"));
    }

    // A path segment reaches a URL. A repository name or a filename with a
    // space or a hash in it must not end the path or start a fragment.
    #[test]
    fn escapes_a_path_without_escaping_its_separators() {
        let url = contents_url("o/r", "some dir/a#b.txt");
        assert!(url.contains("some%20dir/a%23b.txt"), "got {url}");
        assert!(url.contains("/repos/o/r/contents/"));
    }
}

#[cfg(test)]
mod dashboard_tests {
    use super::*;

    const EVENTS: &str = include_str!("../fixtures/gh-events.json");
    const CONTRIB: &str = include_str!("../fixtures/gh-contributions.json");
    const PROFILE: &str = include_str!("../fixtures/gh-profile.json");

    #[test]
    fn reads_the_counts_the_overview_shows() {
        let p = parse_profile(PROFILE).expect("fixture parses");
        assert_eq!(p.login, "kartikeyajay2006");
        assert_eq!(p.name.as_deref(), Some("Kartikeya Yadav"));
        assert_eq!(p.bio.as_deref(), Some("Focus · Build · Ship"));
        assert_eq!(p.public_repos, 27);
        assert_eq!(p.followers, 142);
        assert_eq!(p.following, 98);
    }

    // ---- the activity feed ----

    #[test]
    fn turns_events_into_sentences() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        assert!(feed.len() >= 6);
        assert_eq!(feed[0].verb, "Pushed to");
        assert_eq!(feed[0].repo, "torvalds/linux");
    }

    // "Opened" and "Merged" are different events on the same type, and a feed
    // that called both "pull request" would say nothing useful.
    #[test]
    fn tells_an_opened_pull_request_from_a_merged_one() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        let opened = feed.iter().find(|a| a.detail.contains("Add config file")).unwrap();
        let merged = feed.iter().find(|a| a.detail.contains("Fix Windows build")).unwrap();
        assert_eq!(opened.verb, "Opened PR");
        assert_eq!(merged.verb, "Merged PR");
    }

    #[test]
    fn names_a_closed_issue_and_a_star() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        assert!(feed.iter().any(|a| a.verb == "Closed issue" && a.detail.contains("Invalid config")));
        assert!(feed.iter().any(|a| a.verb == "Starred" && a.repo == "sindresorhus/awesome"));
    }

    #[test]
    fn names_a_branch_that_was_created() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        assert!(feed.iter().any(|a| a.verb == "Created branch" && a.detail == "feat/apps"));
    }

    // GitHub adds event types. One this build has never heard of must not
    // break the feed or appear as a blank row.
    #[test]
    fn passes_over_an_event_type_it_does_not_know() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        assert!(!feed.iter().any(|a| a.verb.is_empty()));
        assert!(!feed.iter().any(|a| a.verb.contains("SomeFuture")));
    }

    // A large push arrives with its commit list truncated to nothing. The row
    // still has to say something, and the branch is what it knows.
    #[test]
    fn describes_a_push_whose_commits_were_truncated() {
        let feed = parse_activity(EVENTS).expect("fixture parses");
        assert_eq!(feed[0].detail, "master");
    }

    #[test]
    fn refuses_an_event_list_it_cannot_read() {
        assert!(parse_activity("not json").is_err());
    }

    // ---- contributions ----

    #[test]
    fn reads_the_contribution_calendar() {
        let c = parse_contributions(CONTRIB).expect("fixture parses");
        assert_eq!(c.total, 1337);
        assert_eq!(c.weeks.len(), 3);
        assert_eq!(c.weeks[0].len(), 7);
    }

    // The heatmap needs a level, not a raw count: the scale is relative to the
    // busiest day, so a quiet year is not rendered as a blank year.
    #[test]
    fn grades_each_day_against_the_busiest_one() {
        let c = parse_contributions(CONTRIB).expect("fixture parses");
        let levels: Vec<u8> = c.weeks.iter().flatten().map(|d| d.level).collect();
        assert!(levels.iter().all(|l| *l <= 4));
        assert!(levels.contains(&0), "a day with nothing is level 0");
        assert!(levels.contains(&4), "the busiest day is level 4");
    }

    #[test]
    fn a_year_with_no_contributions_is_all_level_zero() {
        let json = r#"{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{
            "totalContributions":0,
            "weeks":[{"contributionDays":[{"date":"2026-01-01","contributionCount":0}]}]}}}}}"#;
        let c = parse_contributions(json).expect("parses");
        assert_eq!(c.total, 0);
        assert_eq!(c.weeks[0][0].level, 0);
    }

    // GraphQL answers HTTP 200 with an `errors` array, so the status says
    // nothing and a caller that only checked it would show an empty heatmap.
    #[test]
    fn refuses_a_graphql_reply_carrying_errors() {
        let json = r#"{"errors":[{"message":"Bad credentials"}]}"#;
        assert!(parse_contributions(json).is_err());
    }

    #[test]
    fn builds_the_graphql_query_against_the_viewer() {
        let body = contributions_query();
        assert!(body.contains("contributionsCollection"));
        assert!(body.contains("viewer"), "asks about the signed-in account");
        assert!(!body.contains('\n'), "sent as one line");
    }
}
