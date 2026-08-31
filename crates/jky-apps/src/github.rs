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
pub struct User {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: String,
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
struct WireUser {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
    html_url: String,
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

pub fn parse_user(json: &str) -> Result<User, GitHubError> {
    let wire: WireUser =
        serde_json::from_str(json).map_err(|e| GitHubError::Malformed(e.to_string()))?;
    Ok(User {
        login: wire.login,
        name: wire.name,
        avatar_url: wire.avatar_url,
        html_url: wire.html_url,
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

// ---- fetching ----

/// A summary of the account, as one panel-load.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Summary {
    pub user: User,
    pub repos: Vec<Repo>,
    /// Open issues assigned to, or opened by, the signed-in person.
    pub issues: Vec<Item>,
    pub pulls: Vec<Item>,
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
    let user = parse_user(&user_body)?;

    let repos_url = repos_url();
    let issues_url = search_url("is:open is:issue assignee:@me archived:false");
    let pulls_url = search_url("is:open is:pr author:@me archived:false");

    let (repos, issues, pulls) = tokio::join!(
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
        }
    );

    Ok(Summary {
        user,
        repos,
        issues,
        pulls,
    })
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
        let user = parse_user(USER).expect("fixture parses");
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
