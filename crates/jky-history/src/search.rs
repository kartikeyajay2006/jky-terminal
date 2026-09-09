use std::collections::HashMap;

use crate::entry::{Entry, Hit};

/// What a search is asking for.
#[derive(Debug, Clone, Default)]
pub struct Query {
    /// Words to find. Empty means "everything", most recent first.
    pub text: String,
    /// Only commands run in this pane, when set.
    pub session: Option<String>,
    /// Only commands that failed.
    pub failed_only: bool,
    /// Only commands run in this directory.
    pub cwd: Option<String>,
    pub limit: usize,
}

/// How many results a search returns when the caller does not say.
pub const DEFAULT_LIMIT: usize = 200;

/**
 * Does `needle` appear in `haystack`, in order but not necessarily together?
 *
 * Subsequence rather than substring, because that is how people remember a
 * command: `dkrps` should find `docker ps`, and `gcm` should find
 * `git commit -m`. Returns the span it matched across — a match packed into
 * ten characters is a better one than the same letters scattered over ninety,
 * and the ranking uses that.
 */
fn subsequence_span(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }

    let hay: Vec<char> = haystack.chars().collect();
    let mut start = None;
    let mut end = 0;
    let mut wanted = needle.chars().peekable();

    for (i, c) in hay.iter().enumerate() {
        let Some(next) = wanted.peek() else { break };
        if c == next {
            if start.is_none() {
                start = Some(i);
            }
            end = i;
            wanted.next();
        }
    }

    if wanted.peek().is_some() {
        return None;
    }
    Some(end - start.unwrap_or(0) + 1)
}

/// Case-insensitive, and only lowered once per call rather than per entry.
fn matches(entry: &Entry, needle: &str) -> Option<usize> {
    subsequence_span(&entry.command.to_lowercase(), needle)
}

/**
 * Rank a match.
 *
 * Three things decide it, in the order they matter:
 *
 * - **How tightly the query matched.** `dkrps` inside `docker ps` beats the
 *   same letters scattered across a ninety-character pipeline.
 * - **How often the command has been run.** A command typed forty times is
 *   one you want again; a command typed once may have been a typo.
 * - **How recently.** Between two commands you use equally often, the answer
 *   is nearly always the one from this afternoon.
 *
 * Frequency is damped with a logarithm rather than counted straight: without
 * it, a `ls` run five hundred times would outrank every specific thing you
 * were actually looking for.
 */
fn score(span: usize, needle_len: usize, count: u32, last_at: i64, now: i64) -> f64 {
    // One when the query matched a run of adjacent characters, falling away
    // as the same letters are found further apart. Measured against the
    // query rather than the command: a long command is not a worse answer,
    // a scattered match is.
    let tightness = if span == 0 { 1.0 } else { needle_len as f64 / span as f64 };

    let frequency = (count as f64 + 1.0).ln();

    // Halves every fortnight. Long enough that last month's work is still
    // findable, short enough that this week's rises above it.
    let age_days = ((now - last_at).max(0) as f64) / 86_400_000.0;
    let recency = 0.5_f64.powf(age_days / 14.0);

    tightness * 2.0 + frequency + recency * 3.0
}

/// Search a set of entries, newest first within equal scores.
pub fn search(entries: &[Entry], query: &Query, now: i64) -> Vec<Hit> {
    let needle = query.text.trim().to_lowercase();

    // How often each distinct command has run, and when it last did. Counted
    // across everything rather than across the filtered set: a command's
    // history does not change because you narrowed the view to one pane.
    let mut counts: HashMap<&str, (u32, i64)> = HashMap::new();
    for entry in entries {
        let slot = counts.entry(entry.command.as_str()).or_insert((0, i64::MIN));
        slot.0 += 1;
        slot.1 = slot.1.max(entry.at);
    }

    // Newest occurrence of each command only. A search that returned the same
    // line forty times would bury everything else you have ever run.
    let mut best: HashMap<&str, (&Entry, usize)> = HashMap::new();
    for entry in entries {
        if query.failed_only && entry.code == 0 {
            continue;
        }
        if let Some(session) = &query.session {
            if &entry.session != session {
                continue;
            }
        }
        if let Some(cwd) = &query.cwd {
            if &entry.cwd != cwd {
                continue;
            }
        }
        let Some(span) = matches(entry, &needle) else { continue };

        match best.get(entry.command.as_str()) {
            Some((kept, _)) if kept.at >= entry.at => {}
            _ => {
                best.insert(entry.command.as_str(), (entry, span));
            }
        }
    }

    let mut hits: Vec<(f64, Hit)> = best
        .into_values()
        .map(|(entry, span)| {
            let (count, last_at) = counts.get(entry.command.as_str()).copied().unwrap_or((1, entry.at));
            let points = score(span, needle.chars().count(), count, last_at, now);
            (points, Hit { entry: entry.clone(), count, last_at })
        })
        .collect();

    hits.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.1.last_at.cmp(&a.1.last_at))
            .then(a.1.entry.command.cmp(&b.1.entry.command))
    });

    let limit = if query.limit == 0 { DEFAULT_LIMIT } else { query.limit };
    hits.into_iter().take(limit).map(|(_, hit)| hit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;

    fn entry(command: &str, at: i64) -> Entry {
        Entry {
            command: command.to_string(),
            cwd: "/home/k".into(),
            code: 0,
            at,
            session: "pane-1".into(),
            host: None,
        }
    }

    fn commands(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.entry.command.as_str()).collect()
    }

    fn find(entries: &[Entry], text: &str) -> Vec<Hit> {
        search(entries, &Query { text: text.into(), ..Default::default() }, NOW)
    }

    #[test]
    fn an_empty_query_returns_everything_newest_first() {
        let entries = vec![entry("one", NOW - DAY), entry("two", NOW)];
        assert_eq!(commands(&find(&entries, "")), ["two", "one"]);
    }

    #[test]
    fn finds_a_command_by_letters_scattered_through_it() {
        // How people actually remember a command.
        let entries = vec![entry("docker ps", NOW), entry("git status", NOW)];
        assert_eq!(commands(&find(&entries, "dkrps")), ["docker ps"]);
        assert_eq!(commands(&find(&entries, "gsta")), ["git status"]);
    }

    #[test]
    fn ignores_case() {
        let entries = vec![entry("Docker PS", NOW)];
        assert_eq!(commands(&find(&entries, "docker")), ["Docker PS"]);
    }

    #[test]
    fn prefers_the_tighter_match() {
        // The same letters scattered over a long pipeline is a worse answer
        // than the short command they were probably meant for.
        let entries = vec![
            entry("docker ps", NOW),
            entry("d something o something c something k something ps", NOW),
        ];
        assert_eq!(commands(&find(&entries, "dockps"))[0], "docker ps");
    }

    #[test]
    fn prefers_what_is_run_often() {
        let mut entries = vec![entry("git push", NOW - DAY)];
        for i in 0..20 {
            entries.push(entry("git pull", NOW - DAY - i));
        }
        assert_eq!(commands(&find(&entries, "git p"))[0], "git pull");
    }

    #[test]
    fn prefers_what_is_recent_between_equals() {
        let entries = vec![entry("make test", NOW - 60 * DAY), entry("make build", NOW)];
        assert_eq!(commands(&find(&entries, "make"))[0], "make build");
    }

    #[test]
    fn a_command_appears_once_however_often_it_ran() {
        // Forty identical lines would bury everything else ever run.
        let entries: Vec<Entry> = (0..40).map(|i| entry("ls", NOW - i)).collect();
        let hits = find(&entries, "ls");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].count, 40);
    }

    #[test]
    fn the_row_shown_is_the_most_recent_run_of_it() {
        let mut old = entry("deploy", NOW - 10 * DAY);
        old.cwd = "/old".into();
        let entries = vec![old, entry("deploy", NOW)];

        let hits = find(&entries, "deploy");
        assert_eq!(hits[0].entry.cwd, "/home/k");
        assert_eq!(hits[0].last_at, NOW);
    }

    #[test]
    fn narrows_to_one_session() {
        let mut other = entry("in the other split", NOW);
        other.session = "pane-9".into();
        let entries = vec![entry("here", NOW), other];

        let hits = search(
            &entries,
            &Query { session: Some("pane-1".into()), ..Default::default() },
            NOW,
        );
        assert_eq!(commands(&hits), ["here"]);
    }

    #[test]
    fn narrows_to_what_failed() {
        let mut broken = entry("cargo build", NOW);
        broken.code = 101;
        let entries = vec![entry("cargo test", NOW), broken];

        let hits = search(&entries, &Query { failed_only: true, ..Default::default() }, NOW);
        assert_eq!(commands(&hits), ["cargo build"]);
    }

    #[test]
    fn narrows_to_one_directory() {
        let mut elsewhere = entry("ls", NOW);
        elsewhere.cwd = "/tmp".into();
        let entries = vec![entry("pwd", NOW), elsewhere];

        let hits = search(&entries, &Query { cwd: Some("/tmp".into()), ..Default::default() }, NOW);
        assert_eq!(commands(&hits), ["ls"]);
    }

    #[test]
    fn a_narrowed_view_does_not_change_how_often_a_command_has_run() {
        // The count is a fact about the history, not about the filter.
        let mut other = entry("ls", NOW);
        other.session = "pane-9".into();
        let entries = vec![entry("ls", NOW - 1), other];

        let hits = search(
            &entries,
            &Query { session: Some("pane-1".into()), ..Default::default() },
            NOW,
        );
        assert_eq!(hits[0].count, 2);
    }

    #[test]
    fn honours_a_limit() {
        let entries: Vec<Entry> = (0..50).map(|i| entry(&format!("cmd{i}"), NOW - i)).collect();
        assert_eq!(search(&entries, &Query { limit: 5, ..Default::default() }, NOW).len(), 5);
    }

    #[test]
    fn finds_nothing_rather_than_guessing() {
        let entries = vec![entry("docker ps", NOW)];
        assert!(find(&entries, "kubectl").is_empty());
    }

    #[test]
    fn a_subsequence_must_be_in_order() {
        assert!(subsequence_span("docker ps", "psdocker").is_none());
        assert!(subsequence_span("docker ps", "dops").is_some());
    }
}
