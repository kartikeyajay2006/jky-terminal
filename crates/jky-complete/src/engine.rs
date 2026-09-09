use std::path::Path;

use serde::Serialize;

use crate::line::{parse, Slot};
use crate::sources::{executables, git_branches, npm_scripts, on_path, paths, Kind, Suggestion};
use crate::spec::{spec_for, takes_for, Takes};

/// What the caller knows about where the cursor is.
#[derive(Debug, Clone)]
pub struct Context {
    pub line: String,
    /// Byte offset of the cursor within `line`.
    pub cursor: usize,
    /// The shell's working directory, as the shell most recently reported it.
    pub cwd: String,
    /// The user's home, for expanding `~`. None where the OS will not say.
    pub home: Option<String>,
    /// `PATH`, for completing a program name.
    pub path_var: Option<String>,
    /// Commands run before, most recent first, for the last-resort source.
    pub history: Vec<String>,
    pub limit: usize,
}

/// What to show, and what to replace with it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Completions {
    /// Byte offset where the replaced word begins.
    pub start: usize,
    /// Byte offset where it ends — the cursor.
    pub end: usize,
    /// The word being completed, so the caller can highlight the match.
    pub word: String,
    pub items: Vec<Suggestion>,
}

const DEFAULT_LIMIT: usize = 40;

/// Everything that could come next, best first.
///
/// The routing is the whole design: which source is asked is decided by where
/// the cursor is and what the command takes, so a branch is never offered
/// where a file belongs. A source that has nothing to say returns nothing,
/// and the answer is then honestly empty rather than filled with whatever was
/// cheapest to produce.
pub fn complete(context: &Context) -> Completions {
    let line = parse(&context.line, context.cursor);
    let cwd = Path::new(&context.cwd);
    let home = context.home.as_deref().map(Path::new);

    let mut items: Vec<Suggestion> = match line.slot {
        // The first word is a program. History comes too, because half of
        // what anyone types is something they have typed before — but after
        // the programs, since a program that exists beats a line that ran.
        Slot::Command => executables(&line.word, context.path_var.as_deref()),

        Slot::Flag => match line.command.as_deref().and_then(|c| known(c, context)) {
            Some(spec) => spec
                .flags
                .iter()
                .filter(|f| f.name.starts_with(&line.word))
                .map(|f| Suggestion {
                    value: f.name.to_string(),
                    display: f.name.to_string(),
                    kind: Kind::Flag,
                    detail: f.detail.to_string(),
                    from: line.word_start,
                })
                .collect(),
            // A flag for a command nobody described. Offering `--force`
            // because another program has one is how a completion becomes a
            // liability.
            None => Vec::new(),
        },

        Slot::Argument => {
            let spec = line.command.as_deref().and_then(|c| known(c, context));

            // A subcommand, when one has not been chosen yet.
            let mut found: Vec<Suggestion> = spec
                .filter(|s| !s.subcommands.is_empty())
                .filter(|_| line.args.iter().all(|a| a.starts_with('-')))
                .map(|s| {
                    s.subcommands
                        .iter()
                        .filter(|c| c.name.starts_with(&line.word))
                        .map(|c| Suggestion {
                            value: c.name.to_string(),
                            display: c.name.to_string(),
                            kind: Kind::Flag,
                            detail: c.detail.to_string(),
                            from: line.word_start,
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            let takes = spec.map(|s| takes_for(s, &line.args)).unwrap_or(Takes::Paths);
            match takes {
                Takes::Branches => found.extend(
                    git_branches(cwd).into_iter().filter(|b| b.value.starts_with(&line.word)),
                ),
                Takes::Scripts => found.extend(
                    npm_scripts(cwd).into_iter().filter(|s| s.value.starts_with(&line.word)),
                ),
                Takes::Directories => found.extend(
                    paths(&line.word, cwd, home).into_iter().filter(|p| p.kind == Kind::Directory),
                ),
                Takes::Paths => found.extend(paths(&line.word, cwd, home)),
                Takes::Nothing => {}
            }
            found
        }
    };

    // The sources return names, not spans — they have no idea where in the
    // line the word they matched sits. Filled in here, once, so no source
    // can get it wrong.
    for item in &mut items {
        item.from = line.word_start;
    }

    // History last, and against the whole command rather than the word: its
    // value is that a long invocation comes back in one press, which is a
    // thing you notice several words in — `docker r` should still recall
    // `docker run --rm -it node:20 bash`.
    let typed = &context.line[line.segment_start.min(context.line.len())..cursor_of(context)];
    items.extend(from_history(&context.history, typed.trim_start(), line.segment_start));

    rank(&mut items, &line.word);
    items.dedup_by(|a, b| a.value == b.value);

    let limit = if context.limit == 0 { DEFAULT_LIMIT } else { context.limit };
    items.truncate(limit);

    Completions { start: line.word_start, end: cursor_of(context), word: line.word, items }
}

/// The cursor, clamped to the line and to a character boundary.
///
/// The window measures in UTF-16 and Rust in bytes, so a cursor that lands
/// inside a multi-byte character is a thing that happens rather than a thing
/// that is merely possible — and slicing there would panic.
fn cursor_of(context: &Context) -> usize {
    let mut at = context.cursor.min(context.line.len());
    while at > 0 && !context.line.is_char_boundary(at) {
        at -= 1;
    }
    at
}

/// The spec for a command, when the machine actually has that command.
///
/// Offering `docker ps` where docker is not installed is offering something
/// that cannot work, and the person finds out only after pressing Enter. The
/// check is a few `is_file` calls against PATH, which is the same work the
/// shell does to run it.
fn known(command: &str, context: &Context) -> Option<&'static crate::spec::Spec> {
    let spec = spec_for(command)?;
    // A path was typed out, so whether it is on PATH says nothing.
    if command.contains('/') || command.contains('\\') {
        return Some(spec);
    }
    // No PATH to check against is not evidence of absence.
    match context.path_var.as_deref() {
        Some(path_var) if !on_path(spec.command, Some(path_var)) => None,
        _ => Some(spec),
    }
}

/// Lines run before that begin with what is being typed.
///
/// Whole command lines, not words: the value of history here is that
/// `docker run --rm -it -v $PWD:/app node:20 bash` comes back in one press.
fn from_history(history: &[String], typed: &str, from: usize) -> Vec<Suggestion> {
    if typed.trim().is_empty() {
        return Vec::new();
    }
    let lowered = typed.to_lowercase();
    let mut seen = std::collections::BTreeSet::new();
    history
        .iter()
        .filter(|line| line.to_lowercase().starts_with(&lowered))
        // A recalled line identical to what is already typed completes to
        // nothing, which reads as a suggestion that does not work.
        .filter(|line| line.len() > typed.len())
        .filter(|line| seen.insert(line.to_string()))
        .map(|command| Suggestion {
            value: command.clone(),
            display: command.clone(),
            kind: Kind::History,
            detail: String::new(),
            from,
        })
        .collect()
}

/// Order the answers.
///
/// An exact prefix beats a case-insensitive one, a shorter answer beats a
/// longer one that also matches, and directories come before files because a
/// path being completed is usually on its way somewhere. Within all of that
/// the order is alphabetical, so the list does not reshuffle as you type.
fn rank(items: &mut [Suggestion], word: &str) {
    items.sort_by(|a, b| {
        let exact = |s: &Suggestion| !word.is_empty() && s.value.starts_with(word);
        exact(b)
            .cmp(&exact(a))
            .then(kind_order(a.kind).cmp(&kind_order(b.kind)))
            .then(a.value.chars().count().cmp(&b.value.chars().count()))
            .then(a.value.cmp(&b.value))
    });
}

/// Which kinds are worth seeing first.
fn kind_order(kind: Kind) -> u8 {
    match kind {
        // A subcommand or flag is a small, closed set that was asked for
        // specifically; a directory leads somewhere; history is the fallback
        // that always has something to say and is therefore last.
        Kind::Flag => 0,
        Kind::Branch | Kind::Script => 1,
        Kind::Directory => 2,
        Kind::Executable => 3,
        Kind::File => 4,
        Kind::History => 5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn context(line: &str, cwd: &Path) -> Context {
        Context {
            line: line.to_string(),
            cursor: line.len(),
            cwd: cwd.to_string_lossy().to_string(),
            home: None,
            path_var: None,
            history: Vec::new(),
            limit: 0,
        }
    }

    fn values(found: &Completions) -> Vec<&str> {
        found.items.iter().map(|s| s.value.as_str()).collect()
    }

    fn repo() -> TempDir {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join(".git/refs/heads")).unwrap();
        std::fs::write(d.path().join(".git/refs/heads/main"), "a\n").unwrap();
        std::fs::write(d.path().join(".git/refs/heads/mainline-fix"), "b\n").unwrap();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::write(d.path().join("main.rs"), "").unwrap();
        d
    }

    #[test]
    fn offers_git_subcommands_where_a_subcommand_belongs() {
        let d = repo();
        assert_eq!(values(&complete(&context("git che", d.path()))), ["checkout"]);
    }

    #[test]
    fn offers_branches_after_checkout_and_not_files() {
        // `main.rs` is right there and is not an answer to `git checkout`.
        let d = repo();
        let found = complete(&context("git checkout ma", d.path()));
        assert_eq!(values(&found), ["main", "mainline-fix"]);
    }

    #[test]
    fn offers_files_after_git_add_and_not_branches() {
        let d = repo();
        let found = complete(&context("git add ma", d.path()));
        assert_eq!(values(&found), ["main.rs"]);
    }

    #[test]
    fn offers_flags_only_for_a_command_it_knows() {
        let d = repo();
        assert!(values(&complete(&context("git --am", d.path()))).contains(&"--amend"));
        // Offering `--force` because some other program has one is how a
        // completion becomes a liability.
        assert_eq!(values(&complete(&context("kubectl --fo", d.path()))), Vec::<&str>::new());
    }

    #[test]
    fn declines_to_describe_a_command_the_machine_does_not_have() {
        // Offering `docker ps` where docker is not installed is offering
        // something that cannot work, found out only after pressing Enter.
        let empty = TempDir::new().unwrap();
        let d = repo();
        let mut ctx = context("docker p", d.path());
        ctx.path_var = Some(empty.path().to_string_lossy().to_string());

        assert!(!values(&complete(&ctx)).contains(&"ps"));

        std::fs::write(empty.path().join("docker"), "").unwrap();
        assert!(values(&complete(&ctx)).contains(&"ps"));
    }

    #[test]
    fn no_path_to_check_against_is_not_evidence_of_absence() {
        let d = repo();
        assert!(values(&complete(&context("docker p", d.path()))).contains(&"ps"));
    }

    #[test]
    fn a_flag_carries_what_it_is_for() {
        let d = repo();
        let found = complete(&context("git --am", d.path()));
        assert_eq!(found.items[0].detail, "replace the last commit");
    }

    #[test]
    fn cd_offers_directories_and_never_a_file() {
        let d = repo();
        assert_eq!(values(&complete(&context("cd ", d.path()))), ["src/"]);
    }

    #[test]
    fn an_unknown_command_still_completes_paths() {
        // The honest default: nothing is known about `frobnicate`, but a path
        // is what most arguments are.
        let d = repo();
        assert_eq!(values(&complete(&context("frobnicate ma", d.path()))), ["main.rs"]);
    }

    #[test]
    fn says_exactly_what_to_replace() {
        let d = repo();
        let found = complete(&context("git checkout ma", d.path()));
        assert_eq!(found.start, 13);
        assert_eq!(found.end, 15);
        assert_eq!(found.word, "ma");
    }

    #[test]
    fn the_replacement_span_survives_a_pipe() {
        let d = repo();
        let line = "ls | git checkout ma";
        let found = complete(&context(line, d.path()));
        assert_eq!(&line[found.start..found.end], "ma");
    }

    #[test]
    fn prefers_an_exact_prefix_over_one_that_ignores_case() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("README"), "").unwrap();
        std::fs::write(d.path().join("readme.txt"), "").unwrap();

        assert_eq!(values(&complete(&context("cat rea", d.path())))[0], "readme.txt");
    }

    #[test]
    fn prefers_the_shorter_of_two_matches() {
        let d = repo();
        assert_eq!(values(&complete(&context("git checkout ma", d.path())))[0], "main");
    }

    #[test]
    fn puts_directories_before_files() {
        // A path being completed is usually on its way somewhere.
        let d = TempDir::new().unwrap();
        std::fs::create_dir(d.path().join("aaa-dir")).unwrap();
        std::fs::write(d.path().join("aaa-file"), "").unwrap();

        assert_eq!(values(&complete(&context("cat aaa", d.path())))[0], "aaa-dir/");
    }

    #[test]
    fn a_recalled_line_replaces_the_whole_command_not_the_word() {
        // Or `docker r` completed from history becomes `docker docker run …`.
        let d = repo();
        let mut ctx = context("docker r", d.path());
        ctx.history = vec!["docker run --rm -it node:20 bash".into()];

        let found = complete(&ctx);
        let recalled = found.items.iter().find(|s| s.kind == Kind::History).unwrap();
        assert_eq!(recalled.from, 0);
        // Against a path completion in the same answer, which replaces only
        // the word.
        assert!(found.items.iter().any(|s| s.kind != Kind::History && s.from == 7));
    }

    #[test]
    fn a_recalled_line_replaces_only_its_side_of_a_pipe() {
        let d = repo();
        let line = "ls -l | docker r";
        let mut ctx = context(line, d.path());
        ctx.history = vec!["docker run --rm -it node:20 bash".into()];

        let found = complete(&ctx);
        let recalled = found.items.iter().find(|s| s.kind == Kind::History).unwrap();
        assert_eq!(line[..recalled.from].trim_end(), "ls -l |");
    }

    #[test]
    fn does_not_recall_a_line_identical_to_what_is_typed() {
        // Completing to nothing reads as a suggestion that does not work.
        let d = repo();
        let mut ctx = context("make test", d.path());
        ctx.history = vec!["make test".into()];
        assert!(!complete(&ctx).items.iter().any(|s| s.kind == Kind::History));
    }

    #[test]
    fn recalls_a_long_invocation_several_words_in() {
        let d = repo();
        let mut ctx = context("docker run --rm -it no", d.path());
        ctx.history = vec!["docker run --rm -it node:20 bash".into()];
        assert!(complete(&ctx).items.iter().any(|s| s.kind == Kind::History));
    }

    #[test]
    fn completes_a_whole_line_from_history() {
        // The value of history here is that a long invocation comes back in
        // one press, not that a word does.
        let d = repo();
        let mut ctx = context("doc", d.path());
        ctx.history = vec!["docker run --rm -it node:20 bash".into()];

        assert_eq!(values(&complete(&ctx)), ["docker run --rm -it node:20 bash"]);
    }

    #[test]
    fn a_program_that_exists_beats_a_line_that_ran() {
        let bin = TempDir::new().unwrap();
        std::fs::write(bin.path().join("dockerthing"), "").unwrap();
        let d = repo();

        let mut ctx = context("dock", d.path());
        ctx.path_var = Some(bin.path().to_string_lossy().to_string());
        ctx.history = vec!["dock the boat".into()];

        assert_eq!(values(&complete(&ctx))[0], "dockerthing");
    }

    #[test]
    fn history_is_offered_once_however_often_it_ran() {
        let d = repo();
        let mut ctx = context("make", d.path());
        ctx.history = vec!["make test".into(), "make test".into(), "make test".into()];
        assert_eq!(values(&complete(&ctx)), ["make test"]);
    }

    #[test]
    fn offers_nothing_for_an_empty_command_rather_than_everything() {
        // Every program on the machine answers no question.
        let d = repo();
        let mut ctx = context("", d.path());
        ctx.history = vec!["make test".into()];
        assert_eq!(values(&complete(&ctx)), Vec::<&str>::new());
    }

    #[test]
    fn honours_a_limit() {
        let d = TempDir::new().unwrap();
        for i in 0..50 {
            std::fs::write(d.path().join(format!("file{i}")), "").unwrap();
        }
        let mut ctx = context("cat file", d.path());
        ctx.limit = 5;
        assert_eq!(found_len(&complete(&ctx)), 5);
    }

    fn found_len(found: &Completions) -> usize {
        found.items.len()
    }

    #[test]
    fn npm_run_offers_scripts_and_npm_install_offers_nothing() {
        let d = TempDir::new().unwrap();
        std::fs::write(
            d.path().join("package.json"),
            r#"{"scripts": {"dev": "vite", "verify": "pnpm test"}}"#,
        )
        .unwrap();

        assert_eq!(values(&complete(&context("npm run ", d.path()))), ["dev", "verify"]);
        assert_eq!(values(&complete(&context("npm install ", d.path()))), Vec::<&str>::new());
    }
}
