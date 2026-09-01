//! News, from real publications.
//!
//! Every source here is an RSS feed a newspaper publishes for exactly this
//! purpose: public, no key, no account, and no scraping. That is what keeps
//! News in the "no auth, ever" tier, and it is also why the list can hold a
//! national daily beside an aggregator without a second code path — RSS is
//! the one thing they all agree on.
//!
//! Only the headline, the link, the section, the time and a one-line summary
//! are taken. Feeds also carry images, which are deliberately left alone: the
//! CSP allows `img-src 'self' data:` and nothing else, so rendering a
//! publisher's image would mean either widening that to arbitrary hosts or
//! proxying every picture through Rust. Neither is worth doing quietly.

use futures_util::future::join_all;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum NewsError {
    #[error("the news service sent a reply this could not read: {0}")]
    Malformed(String),
    #[error("could not reach the news service: {0}")]
    Network(String),
    #[error("the news service answered with status {0}")]
    Upstream(u16),
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

impl NewsError {
    /// Whether trying again is worth doing.
    ///
    /// A refused or dropped connection is a blip. An answer is not: the server
    /// spoke, and asking again gets the same sentence back. The exception is a
    /// 5xx, which says the far side broke rather than that the request was
    /// wrong, and a second attempt often lands somewhere healthy.
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Network(_) => true,
            Self::Upstream(status) => *status >= 500,
            _ => false,
        }
    }
}

/// A publication this app can read.
#[derive(Debug, Clone, Serialize)]
pub struct Source {
    pub id: &'static str,
    pub name: &'static str,
    /// Shown as a grouping in the picker: where this paper reports from.
    pub region: &'static str,
    pub url: &'static str,
}

/// The publications on offer.
///
/// Kept short and named rather than made configurable. A box for "paste an
/// RSS URL" would turn this into an open fetcher pointed wherever the window
/// asked, which is a different and much larger security question than reading
/// a fixed list of newspapers.
pub const SOURCES: &[Source] = &[
    Source {
        id: "thehindu",
        name: "The Hindu",
        region: "India",
        url: "https://www.thehindu.com/news/national/feeder/default.rss",
    },
    Source {
        id: "toi",
        name: "Times of India",
        region: "India",
        url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
    },
    Source {
        id: "indianexpress",
        name: "Indian Express",
        region: "India",
        url: "https://indianexpress.com/section/india/feed/",
    },
    Source {
        id: "bbc",
        name: "BBC World",
        region: "World",
        url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    },
    Source {
        id: "hackernews",
        name: "Hacker News",
        region: "Tech",
        url: "https://news.ycombinator.com/rss",
    },
];

pub fn find_source(id: &str) -> Option<&'static Source> {
    SOURCES.iter().find(|s| s.id == id)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Article {
    pub title: String,
    pub link: String,
    /// A sentence or two, markup removed. Absent when the feed sends none.
    pub summary: Option<String>,
    /// The section it ran in, where the paper says so.
    pub category: Option<String>,
    /// RFC 822, exactly as the feed wrote it. Turned into words by the window,
    /// which already has a date parser and saves a crate in here.
    pub published: Option<String>,
    pub source_id: String,
    pub source_name: String,
    /// The site the link points at, so you can see where it goes.
    pub host: Option<String>,
}

/// The fields of one `<item>`, before it is known to be usable.
#[derive(Default)]
struct Draft {
    title: Option<String>,
    link: Option<String>,
    description: Option<String>,
    category: Option<String>,
    published: Option<String>,
}

/// Plain text out of a feed field.
///
/// Feeds are inconsistent about this: some send bare text, some wrap it in
/// CDATA, and some — Hacker News among them — put a whole anchor tag in the
/// description. Rendered as text that reads as markup; rendered as HTML it
/// would be somewhere a feed could inject into the app. So the tags come out
/// here, once, and everything downstream handles plain text only.
pub fn strip_html(input: &str) -> String {
    let mut text = String::with_capacity(input.len());
    let mut depth = 0usize;

    for ch in input.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => text.push(ch),
            _ => {}
        }
    }

    let decoded = decode_entities(&text);
    // Feeds indent their XML, so a summary arrives full of newlines and runs
    // of spaces that would render as gaps in a single-line row.
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Turn the entities a feed may contain back into characters.
pub(crate) fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start..];

        let Some(end) = after.find(';').filter(|e| *e <= 12) else {
            // A bare ampersand in running text is not an entity.
            out.push('&');
            rest = &after[1..];
            continue;
        };

        let entity = &after[1..end];
        let replacement = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            // The punctuation real prose is written with. Mail and feeds are
            // full of these, and an unknown entity is left as written — so
            // without them a dash arrives on screen as the literal text
            // "&mdash;" in the middle of a sentence.
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            "lsquo" => Some('\u{2018}'),
            "rsquo" => Some('\u{2019}'),
            "ldquo" => Some('\u{201C}'),
            "rdquo" => Some('\u{201D}'),
            "bull" => Some('•'),
            "middot" => Some('·'),
            "laquo" => Some('«'),
            "raquo" => Some('»'),
            "copy" => Some('©'),
            "reg" => Some('®'),
            "trade" => Some('™'),
            "deg" => Some('°'),
            "times" => Some('×'),
            _ => numeric_entity(entity),
        };

        match replacement {
            Some(c) => out.push(c),
            // Unknown entities are left as written rather than dropped: the
            // text is still readable, and guessing would be worse.
            None => out.push_str(&after[..=end]),
        }
        rest = &after[end + 1..];
    }

    out.push_str(rest);
    out
}

fn numeric_entity(entity: &str) -> Option<char> {
    let digits = entity.strip_prefix('#')?;
    let code = match digits.strip_prefix(['x', 'X']) {
        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
        None => digits.parse::<u32>().ok()?,
    };
    char::from_u32(code)
}

/// Read the articles out of one RSS feed.
pub fn parse_feed(xml: &str, source: &Source) -> Result<Vec<Article>, NewsError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut articles = Vec::new();
    let mut draft: Option<Draft> = None;
    let mut field: Option<String> = None;
    let mut buffer = String::new();

    loop {
        match reader.read_event() {
            Err(e) => return Err(NewsError::Malformed(e.to_string())),
            Ok(Event::Eof) => break,

            Ok(Event::Start(tag)) => {
                let name = local_name(tag.name().as_ref());
                if name == "item" || name == "entry" {
                    draft = Some(Draft::default());
                } else if draft.is_some() {
                    field = Some(name);
                    buffer.clear();
                }
            }

            Ok(Event::Text(text)) => {
                if field.is_some() {
                    buffer.push_str(&text.decode().unwrap_or_default());
                }
            }

            // CDATA arrives as its own event, not as text. Missed, every
            // field in a paper that uses it would come back empty.
            Ok(Event::CData(data)) => {
                if field.is_some() {
                    buffer.push_str(&String::from_utf8_lossy(&data));
                }
            }

            Ok(Event::End(tag)) => {
                let name = local_name(tag.name().as_ref());

                if name == "item" || name == "entry" {
                    if let Some(finished) = draft.take() {
                        if let Some(article) = finished.into_article(source) {
                            articles.push(article);
                        }
                    }
                    field = None;
                    continue;
                }

                let Some(current) = field.take() else { continue };
                let Some(d) = draft.as_mut() else { continue };
                if current != name {
                    continue;
                }

                let value = std::mem::take(&mut buffer);
                match current.as_str() {
                    "title" => d.title = Some(value),
                    "link" => d.link = Some(value),
                    "description" | "summary" => d.description = Some(value),
                    "category" => d.category = Some(value),
                    "pubdate" | "published" | "date" => d.published = Some(value),
                    _ => {}
                }
            }

            _ => {}
        }
    }

    Ok(articles)
}

/// A tag name without its namespace prefix, lowercased.
///
/// Feeds mix `<pubDate>` with `<dc:date>` and Atom's `<published>`, so the
/// prefix is noise and the case is not dependable.
fn local_name(raw: &[u8]) -> String {
    let name = String::from_utf8_lossy(raw);
    name.rsplit(':').next().unwrap_or(&name).to_ascii_lowercase()
}

impl Draft {
    /// `None` when the entry cannot be shown.
    ///
    /// Feeds carry the occasional empty row. One of those should cost that
    /// row and nothing else, so it is dropped rather than failing the page.
    fn into_article(self, source: &Source) -> Option<Article> {
        let title = strip_html(&self.title?);
        let link = strip_html(&self.link?);
        if title.is_empty() || !link.starts_with("http") {
            return None;
        }

        let summary = self
            .description
            .map(|d| strip_html(&d))
            .filter(|s| !s.is_empty());

        Some(Article {
            host: host_of(&link),
            title,
            link,
            summary,
            category: self.category.map(|c| strip_html(&c)).filter(|c| !c.is_empty()),
            published: self.published.map(|p| strip_html(&p)).filter(|p| !p.is_empty()),
            source_id: source.id.to_string(),
            source_name: source.name.to_string(),
        })
    }
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, NewsError> {
    let response = client
        .get(url)
        // Some publishers answer a bare client with a challenge page rather
        // than their feed; naming the app is what a feed reader is meant to do.
        .header("User-Agent", "JKY-Terminal/0.1 (+feed reader)")
        .header("Accept", "application/rss+xml, application/xml, text/xml")
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

pub async fn fetch_source(
    client: &reqwest::Client,
    source: &Source,
    limit: usize,
) -> Result<Vec<Article>, NewsError> {
    let body = crate::net::retrying(crate::net::ATTEMPTS, NewsError::is_transient, || {
        get_text(client, source.url)
    })
    .await?;
    let mut articles = parse_feed(&body, source)?;
    articles.truncate(limit);
    Ok(articles)
}

/// Every source at once, for the "All" view.
///
/// A paper that is down costs its own rows rather than the page, which is the
/// same rule the single-source path follows. All of them failing is still an
/// error, because "no news today" would be a lie about a broken connection.
pub async fn fetch_all(
    client: &reqwest::Client,
    per_source: usize,
) -> Result<Vec<Article>, NewsError> {
    let fetched = join_all(
        SOURCES
            .iter()
            .map(|source| async move { fetch_source(client, source, per_source).await.ok() }),
    )
    .await;

    let articles: Vec<Article> = fetched.into_iter().flatten().flatten().collect();

    if articles.is_empty() {
        return Err(NewsError::Network(
            "none of the papers could be reached".into(),
        ));
    }

    Ok(articles)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HINDU: &str = include_str!("../fixtures/rss-thehindu.xml");
    const HN: &str = include_str!("../fixtures/rss-hackernews.xml");

    fn hindu() -> &'static Source {
        find_source("thehindu").expect("the fixture's source is registered")
    }


    #[test]
    fn only_connection_failures_and_server_faults_are_worth_retrying() {
        assert!(NewsError::Network("refused".into()).is_transient());
        assert!(NewsError::Upstream(502).is_transient());
        assert!(!NewsError::Upstream(404).is_transient());
        assert!(!NewsError::Malformed("not xml".into()).is_transient());
    }

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

    #[test]
    fn every_source_is_named_and_reachable_over_https() {
        for source in SOURCES {
            assert!(!source.name.trim().is_empty(), "a source has no name");
            assert!(
                source.url.starts_with("https://"),
                "{} is not https: {}",
                source.name,
                source.url
            );
            assert!(source.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        }
    }

    #[test]
    fn source_ids_are_unique() {
        let mut ids: Vec<&str> = SOURCES.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), before, "two sources share an id");
    }

    #[test]
    fn finds_a_source_by_id_and_nothing_for_an_unknown_one() {
        assert_eq!(find_source("thehindu").map(|s| s.id), Some("thehindu"));
        assert!(find_source("not-a-paper").is_none());
    }

    #[test]
    fn reads_the_articles_out_of_a_real_feed() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        assert_eq!(articles.len(), 3);
        assert!(!articles[0].title.is_empty());
        assert!(articles[0].link.starts_with("https://"));
    }

    // The Hindu wraps nearly every field in CDATA. Left in, the title would
    // render with the wrapper still around it.
    #[test]
    fn unwraps_cdata() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        for a in &articles {
            assert!(!a.title.contains("CDATA"), "title still wrapped: {}", a.title);
            assert!(!a.link.contains("CDATA"), "link still wrapped: {}", a.link);
        }
    }

    #[test]
    fn keeps_the_section_a_story_ran_in() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        assert!(articles.iter().any(|a| a.category.is_some()));
    }

    #[test]
    fn keeps_the_time_it_was_published() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        // Passed through as the feed wrote it; the window turns RFC 822 into
        // words, which it can do without a date crate in here.
        assert!(articles[0].published.as_deref().unwrap_or("").contains("2026"));
    }

    #[test]
    fn names_the_source_on_every_article() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        for a in &articles {
            assert_eq!(a.source_id, "thehindu");
            assert_eq!(a.source_name, "The Hindu");
        }
    }

    #[test]
    fn reads_a_second_publication_with_the_same_parser() {
        let hn = find_source("hackernews").expect("registered");
        let articles = parse_feed(HN, hn).expect("fixture parses");
        assert_eq!(articles.len(), 3);
        assert!(!articles[0].title.is_empty());
    }

    // Hacker News puts an anchor tag in every description. Rendered as text
    // that reads as markup; rendered as HTML it would be an injection point.
    #[test]
    fn strips_markup_out_of_a_summary() {
        let hn = find_source("hackernews").expect("registered");
        let articles = parse_feed(HN, hn).expect("fixture parses");
        for a in &articles {
            let summary = a.summary.clone().unwrap_or_default();
            assert!(!summary.contains('<'), "markup survived: {summary}");
            assert!(!summary.contains("href"), "markup survived: {summary}");
        }
    }

    #[test]
    fn turns_html_entities_back_into_characters() {
        assert_eq!(strip_html("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(strip_html("caf&#233;"), "café");
        assert_eq!(strip_html("&lt;not a tag&gt;"), "<not a tag>");
    }

    #[test]
    fn collapses_the_whitespace_a_summary_arrives_with() {
        assert_eq!(strip_html("one\n\n  two\t three "), "one two three");
    }

    #[test]
    fn drops_a_summary_that_was_only_markup() {
        assert_eq!(strip_html("<p></p>  "), "");
    }

    // Feeds carry the occasional empty entry. One bad row should cost that
    // row, not the page.
    #[test]
    fn passes_over_an_item_with_no_title_or_no_link() {
        let xml = r#"<rss><channel>
            <item><link>https://example.com/a</link></item>
            <item><title>No link here</title></item>
            <item><title>Good one</title><link>https://example.com/b</link></item>
        </channel></rss>"#;
        let articles = parse_feed(xml, hindu()).expect("parses");
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Good one");
    }

    #[test]
    fn refuses_something_that_is_not_a_feed() {
        assert!(parse_feed("<<<not xml", hindu()).is_err());
    }

    #[test]
    fn reads_an_empty_feed_as_no_articles_rather_than_an_error() {
        let articles = parse_feed("<rss><channel></channel></rss>", hindu()).expect("parses");
        assert!(articles.is_empty());
    }

    // The domain is shown beside a headline, the same as it is in the old
    // list, so you can see where a link goes before following it out.
    #[test]
    fn names_the_site_each_link_points_at() {
        let articles = parse_feed(HINDU, hindu()).expect("fixture parses");
        assert_eq!(articles[0].host.as_deref(), Some("thehindu.com"));
    }
}
