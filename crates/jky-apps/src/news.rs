//! News, from Hacker News.
//!
//! Chosen for the same reason as the weather service: the API is public, needs
//! no key and no account, and has no rate limit worth working around. That is
//! what lets News sit in the "no auth, ever" tier.
//!
//! The shape is two-step — a list of ids, then one request per item — so this
//! fetches the list once and the items concurrently. Doing them in sequence
//! would be thirty round trips end to end, which is the difference between a
//! panel that fills and a panel that crawls.
//!
//! Note the links go outward. A headline here is a pointer to an article this
//! app does not embed: opening one hands a validated URL to the operating
//! system, the same path a link in the terminal takes. Reading the article in
//! this window needs the Browser app, which is deliberately not built yet.

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const API: &str = "https://hacker-news.firebaseio.com/v0";
const SITE: &str = "https://news.ycombinator.com";

#[derive(Debug, Error)]
pub enum NewsError {
    #[error("the news service sent a reply this could not read: {0}")]
    Malformed(String),
    #[error("could not reach the news service: {0}")]
    Network(String),
    #[error("the news service answered with status {0}")]
    Upstream(u16),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Story {
    pub id: u64,
    pub title: String,
    /// Absent for an Ask HN post, where the discussion is the article.
    pub url: Option<String>,
    /// The site a link points at, for showing where it goes before you follow
    /// it. Absent whenever `url` is.
    pub host: Option<String>,
    pub score: u32,
    pub author: String,
    pub comments: u32,
    /// Unix seconds, as the API reports it.
    pub posted_at: u64,
    /// Where the discussion lives. Built from the id rather than taken from
    /// the response, so it cannot be pointed anywhere else.
    pub discussion_url: String,
}

#[derive(Deserialize)]
struct WireItem {
    id: u64,
    #[serde(rename = "type")]
    kind: Option<String>,
    title: Option<String>,
    url: Option<String>,
    #[serde(default)]
    score: u32,
    by: Option<String>,
    #[serde(default)]
    descendants: u32,
    #[serde(default)]
    time: u64,
}

pub fn parse_ids(json: &str) -> Result<Vec<u64>, NewsError> {
    serde_json::from_str(json).map_err(|e| NewsError::Malformed(e.to_string()))
}

/// One item, or `None` when it is not a story.
///
/// The id lists mix in comments and jobs, and an item can be deleted between
/// being listed and being asked for — which the API answers with a bare
/// `null`. Neither is an error worth showing anyone; both are simply dropped.
pub fn parse_story(json: &str) -> Result<Option<Story>, NewsError> {
    let item: Option<WireItem> =
        serde_json::from_str(json).map_err(|e| NewsError::Malformed(e.to_string()))?;

    let Some(item) = item else { return Ok(None) };
    if item.kind.as_deref() != Some("story") {
        return Ok(None);
    }

    // A story with no headline is nothing this can render, and unlike a
    // missing url it is not a shape the API produces on purpose.
    let title = item
        .title
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| NewsError::Malformed("a story arrived with no title".into()))?;

    let host = item.url.as_deref().and_then(host_of);

    Ok(Some(Story {
        id: item.id,
        title,
        url: item.url,
        host,
        score: item.score,
        author: item.by.unwrap_or_else(|| "unknown".into()),
        comments: item.descendants,
        posted_at: item.time,
        discussion_url: discussion_url(item.id),
    }))
}

/// The site a link points at, without the scheme, port, path or `www.`.
///
/// Hand-rolled rather than pulled from a URL crate: it is a split on two
/// characters, and this is shown beside a headline rather than used to make a
/// request, so a hostname it declines to parse costs a label and nothing else.
pub fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split_once("://")?.1;
    let authority = after_scheme.split(['/', '?', '#']).next()?;
    // Strip any userinfo and port before what is left is called a host.
    let host = authority.rsplit('@').next()?.split(':').next()?;
    if host.is_empty() || !host.contains('.') {
        return None;
    }
    Some(host.strip_prefix("www.").unwrap_or(host).to_string())
}

pub fn top_url() -> String {
    format!("{API}/topstories.json")
}

pub fn item_url(id: u64) -> String {
    format!("{API}/item/{id}.json")
}

pub fn discussion_url(id: u64) -> String {
    format!("{SITE}/item?id={id}")
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, NewsError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| NewsError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(NewsError::Upstream(status.as_u16()));
    }

    response
        .text()
        .await
        .map_err(|e| NewsError::Network(e.to_string()))
}

/// The top stories, at most `limit` of them.
///
/// Items are fetched concurrently and the failures are dropped rather than
/// failing the batch: one story that 500s should cost one row, not the whole
/// panel. An empty list is still an error, because that means none of them
/// worked and showing "no news" would be a lie about a service that is down.
pub async fn fetch_top(client: &reqwest::Client, limit: usize) -> Result<Vec<Story>, NewsError> {
    let ids = parse_ids(&get_text(client, &top_url()).await?)?;
    let wanted: Vec<u64> = ids.into_iter().take(limit).collect();

    if wanted.is_empty() {
        return Ok(Vec::new());
    }

    let fetched = join_all(wanted.iter().map(|id| async move {
        let body = get_text(client, &item_url(*id)).await.ok()?;
        parse_story(&body).ok().flatten()
    }))
    .await;

    let stories: Vec<Story> = fetched.into_iter().flatten().collect();

    if stories.is_empty() {
        return Err(NewsError::Network(
            "none of the stories could be fetched".into(),
        ));
    }

    Ok(stories)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOP: &str = include_str!("../fixtures/hn-topstories.json");
    const STORY: &str = include_str!("../fixtures/hn-story.json");
    const ASK: &str = include_str!("../fixtures/hn-ask.json");
    const COMMENT: &str = include_str!("../fixtures/hn-comment.json");

    #[test]
    fn reads_the_list_of_story_ids() {
        let ids = parse_ids(TOP).expect("fixture parses");
        assert_eq!(ids.len(), 12);
        assert!(ids[0] > 0);
    }

    #[test]
    fn refuses_an_id_list_it_cannot_read() {
        assert!(matches!(parse_ids("nonsense"), Err(NewsError::Malformed(_))));
    }

    #[test]
    fn reads_a_story() {
        let story = parse_story(STORY).expect("fixture parses").expect("is a story");
        assert!(!story.title.is_empty());
        assert!(!story.author.is_empty());
        assert!(story.url.is_some());
        assert!(story.id > 0);
    }

    // An Ask HN post is a story with no link: the discussion is the article.
    // Treating a missing url as malformed would drop a whole class of post.
    #[test]
    fn reads_an_ask_post_that_has_no_link() {
        let story = parse_story(ASK).expect("fixture parses").expect("is a story");
        assert_eq!(story.url, None);
        assert!(story.title.starts_with("Ask HN"));
    }

    // The id lists mix in comments, and an item can be deleted between
    // listing it and asking for it. Neither is an error; both are "not a
    // story", and the caller drops them.
    #[test]
    fn passes_over_a_comment() {
        assert_eq!(parse_story(COMMENT).expect("parses"), None);
    }

    #[test]
    fn passes_over_an_item_that_no_longer_exists() {
        assert_eq!(parse_story("null").expect("parses"), None);
    }

    #[test]
    fn treats_a_story_with_no_replies_as_having_none() {
        let json = r#"{"id":1,"type":"story","title":"t","by":"a","score":3,"time":100}"#;
        let story = parse_story(json).expect("parses").expect("is a story");
        assert_eq!(story.comments, 0);
        assert_eq!(story.score, 3);
    }

    #[test]
    fn refuses_a_story_with_no_title() {
        let json = r#"{"id":1,"type":"story","by":"a","score":3,"time":100}"#;
        assert!(matches!(parse_story(json), Err(NewsError::Malformed(_))));
    }

    #[test]
    fn builds_the_urls_it_fetches() {
        assert!(top_url().starts_with("https://hacker-news.firebaseio.com/"));
        assert!(item_url(42).contains("/item/42.json"));
    }

    // The domain is shown beside a headline so you can see where a link goes
    // before following it out of the app.
    #[test]
    fn names_the_site_a_link_points_at() {
        assert_eq!(host_of("https://arxiv.org/abs/1804.07389"), Some("arxiv.org".to_string()));
        assert_eq!(host_of("http://example.co.uk/x?y=1"), Some("example.co.uk".to_string()));
    }

    #[test]
    fn drops_a_leading_www_because_it_says_nothing() {
        assert_eq!(host_of("https://www.bbc.co.uk/news"), Some("bbc.co.uk".to_string()));
    }

    #[test]
    fn has_no_site_for_something_that_is_not_a_link() {
        assert_eq!(host_of("not a url"), None);
        assert_eq!(host_of(""), None);
    }

    // The discussion link is built from the id rather than taken from the
    // item, so it cannot be pointed anywhere else by the response.
    #[test]
    fn builds_the_discussion_link_from_the_id() {
        let link = discussion_url(49496782);
        assert_eq!(link, "https://news.ycombinator.com/item?id=49496782");
    }
}
