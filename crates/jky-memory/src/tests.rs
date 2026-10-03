use super::*;

fn run(command: &str) -> Run {
    Run { command: command.into(), cwd: "/home/me/api".into(), at: 1_000, session: "tab-1".into(), ..Default::default() }
}

fn texts(found: &[Found]) -> Vec<String> {
    found.iter().map(|f| f.run.command.clone()).collect()
}

fn find(memory: &Memory, text: &str) -> Vec<Found> {
    memory.search(&MemoryQuery { text: text.into(), ..Default::default() }).unwrap()
}

// Assembled at run time so the repository scan, which looks for key shapes in
// the source, does not mistake a fixture for a leaked key.
fn token() -> String {
    format!("ghp_{}", "0123456789abcdefghijklmnopqrstuvwxyz")
}

#[test]
fn a_run_is_kept_with_everything_known_about_it() {
    let memory = Memory::in_memory().unwrap();
    let id = memory
        .record(Run {
            code: 1,
            duration_ms: Some(4_200),
            branch: Some("release".into()),
            rev: Some("2b20c30".into()),
            output: Some("error[E0308]: mismatched types\n".into()),
            host: Some("prod".into()),
            ..run("cargo build --release")
        })
        .unwrap()
        .expect("kept");
    let kept = memory.get(id).unwrap();
    assert_eq!(kept.command, "cargo build --release");
    assert_eq!(kept.duration_ms, Some(4_200));
    assert_eq!(kept.branch.as_deref(), Some("release"));
    assert_eq!(kept.rev.as_deref(), Some("2b20c30"));
    assert_eq!(kept.host.as_deref(), Some("prod"));
    assert_eq!(kept.output.as_deref(), Some("error[E0308]: mismatched types"));
}

#[test]
fn an_empty_command_is_not_kept() {
    let memory = Memory::in_memory().unwrap();
    assert_eq!(memory.record(run("   ")).unwrap(), None);
    assert_eq!(memory.count().unwrap(), 0);
}

#[test]
fn a_search_finds_part_of_a_word_in_the_command() {
    let memory = Memory::in_memory().unwrap();
    memory.record(run("cargo build --release")).unwrap();
    memory.record(run("git push origin main")).unwrap();
    assert_eq!(texts(&find(&memory, "uild")), ["cargo build --release"]);
}

#[test]
fn a_search_looks_inside_what_a_command_printed_and_says_where() {
    let memory = Memory::in_memory().unwrap();
    memory
        .record(Run { output: Some("Compiling api v0.1.0\nerror: linker `cc` not found\n".into()), ..run("cargo build") })
        .unwrap();
    memory.record(run("ls")).unwrap();
    let found = find(&memory, "linker");
    assert_eq!(texts(&found), ["cargo build"]);
    let snippet = found[0].snippet.as_deref().expect("a snippet from the output");
    assert!(snippet.contains("\u{2}linker\u{3}"), "{snippet:?}");
}

#[test]
fn every_word_must_match_and_none_is_read_as_query_syntax() {
    let memory = Memory::in_memory().unwrap();
    memory.record(run("docker compose up")).unwrap();
    memory.record(run("docker ps")).unwrap();
    assert_eq!(texts(&find(&memory, "docker compose")), ["docker compose up"]);
    // FTS operators and stray quotes are text to look for, not syntax.
    for odd in ["NOT", "\"", "command:", "a OR b", "NEAR(x y)", "*"] {
        assert!(memory.search(&MemoryQuery { text: odd.into(), ..Default::default() }).is_ok(), "{odd}");
    }
}

#[test]
fn a_short_word_still_finds_something() {
    let memory = Memory::in_memory().unwrap();
    memory.record(run("ls -la")).unwrap();
    memory.record(run("pwd")).unwrap();
    assert_eq!(texts(&find(&memory, "ls")), ["ls -la"]);
}

#[test]
fn filters_narrow_what_is_found() {
    let memory = Memory::in_memory().unwrap();
    memory.record(Run { code: 2, ..run("make test") }).unwrap();
    memory.record(Run { cwd: "/elsewhere".into(), ..run("make docs") }).unwrap();
    memory.record(Run { session: "tab-9".into(), ..run("make lint") }).unwrap();

    let failed = memory.search(&MemoryQuery { failed_only: true, ..Default::default() }).unwrap();
    assert_eq!(texts(&failed), ["make test"]);
    let here = memory.search(&MemoryQuery { cwd: Some("/elsewhere".into()), ..Default::default() }).unwrap();
    assert_eq!(texts(&here), ["make docs"]);
    let there = memory.search(&MemoryQuery { session: Some("tab-9".into()), ..Default::default() }).unwrap();
    assert_eq!(texts(&there), ["make lint"]);
}

#[test]
fn the_newest_come_first_and_pinned_runs_before_them() {
    let memory = Memory::in_memory().unwrap();
    let old = memory.record(Run { at: 1, ..run("first") }).unwrap().unwrap();
    memory.record(Run { at: 2, ..run("second") }).unwrap();
    memory.record(Run { at: 3, ..run("third") }).unwrap();
    assert_eq!(texts(&find(&memory, "")), ["third", "second", "first"]);

    memory.pin(old, true).unwrap();
    assert_eq!(texts(&find(&memory, "")), ["first", "third", "second"]);
    let pinned = memory.search(&MemoryQuery { pinned_only: true, ..Default::default() }).unwrap();
    assert_eq!(texts(&pinned), ["first"]);
}

#[test]
fn secrets_never_reach_the_database_in_any_field() {
    let memory = Memory::in_memory().unwrap();
    let id = memory
        .record(Run {
            output: Some(format!("token={}\nok\n", token())),
            note: format!("used {}", token()),
            ..run(&format!("export GITHUB_TOKEN={}", token()))
        })
        .unwrap()
        .unwrap();
    memory.note(id, &format!("again {}", token())).unwrap();
    let kept = memory.get(id).unwrap();
    for field in [kept.command, kept.output.unwrap(), kept.note] {
        assert!(!field.contains(&token()), "{field}");
        assert!(field.contains("[redacted"), "{field}");
    }
    // And a search for the secret finds nothing, because it is not there.
    assert!(find(&memory, &token()).is_empty());
}

#[test]
fn output_is_kept_as_text_and_only_its_tail() {
    let memory = Memory::in_memory().unwrap();
    let coloured = "\x1b[31merror\x1b[0m: \x1b]8;;https://x.test\x07link\x1b]8;;\x07 done\r\n";
    let id = memory.record(Run { output: Some(coloured.into()), ..run("a") }).unwrap().unwrap();
    assert_eq!(memory.get(id).unwrap().output.as_deref(), Some("error: link done"));

    let long = format!("{}THE END\n", "line of output\n".repeat(2_000));
    let id = memory.record(Run { output: Some(long), ..run("b") }).unwrap().unwrap();
    let kept = memory.get(id).unwrap().output.unwrap();
    assert!(kept.len() <= OUTPUT_LIMIT, "{} bytes", kept.len());
    assert!(kept.ends_with("THE END"), "the end is what is kept");
    assert!(kept.starts_with("line of output"), "and it starts on a whole line");
}

#[test]
fn a_note_is_searchable_and_bounded() {
    let memory = Memory::in_memory().unwrap();
    let id = memory.record(run("terraform apply")).unwrap().unwrap();
    memory.note(id, "this is the one that finally worked").unwrap();
    assert_eq!(texts(&find(&memory, "finally")), ["terraform apply"]);
    memory.note(id, &"n".repeat(NOTE_LIMIT * 2)).unwrap();
    assert_eq!(memory.get(id).unwrap().note.len(), NOTE_LIMIT);
    assert!(matches!(memory.note(9_999, "x"), Err(MemoryError::NoSuchRun)));
}

#[test]
fn forgetting_removes_a_run_from_search_as_well() {
    let memory = Memory::in_memory().unwrap();
    let id = memory.record(Run { output: Some("secret plans".into()), ..run("cat plans.txt") }).unwrap().unwrap();
    memory.record(run("cat plans.txt")).unwrap();
    memory.forget(id).unwrap();
    assert!(find(&memory, "secret").is_empty(), "the index still had it");
    assert_eq!(memory.forget_command("cat plans.txt").unwrap(), 1);
    assert_eq!(memory.count().unwrap(), 0);
}

#[test]
fn a_forgotten_run_leaves_nothing_in_the_index_for_its_successor_to_inherit() {
    // SQLite reuses the highest row id once it is deleted. If the index kept
    // the forgotten run's words, the next run would be found by them.
    let memory = Memory::in_memory().unwrap();
    let id = memory.record(Run { output: Some("secret plans".into()), ..run("cat plans.txt") }).unwrap().unwrap();
    memory.forget(id).unwrap();
    let next = memory.record(Run { output: Some("nothing to see".into()), ..run("ls") }).unwrap().unwrap();
    assert_eq!(next, id, "the id was reused, which is what makes this matter");
    assert!(find(&memory, "secret").is_empty(), "the new run inherited the old one's words");
}

#[test]
fn retention_spares_what_was_pinned() {
    let memory = Memory::in_memory().unwrap();
    let keep = memory.record(Run { at: 10, ..run("keep me") }).unwrap().unwrap();
    memory.record(Run { at: 20, ..run("old") }).unwrap();
    memory.record(Run { at: 5_000, ..run("new") }).unwrap();
    memory.pin(keep, true).unwrap();
    assert_eq!(memory.prune_older_than(1_000).unwrap(), 1);
    let mut left = texts(&find(&memory, ""));
    left.sort();
    assert_eq!(left, ["keep me", "new"]);
}

#[test]
fn clearing_removes_everything_pinned_included() {
    let memory = Memory::in_memory().unwrap();
    let id = memory.record(run("x")).unwrap().unwrap();
    memory.pin(id, true).unwrap();
    memory.clear().unwrap();
    assert_eq!(memory.count().unwrap(), 0);
    assert!(find(&memory, "").is_empty());
}

#[test]
fn an_import_is_one_transaction_and_skips_empty_lines() {
    let memory = Memory::in_memory().unwrap();
    let kept = memory.import(vec![run("a"), run(""), run("b")]).unwrap();
    assert_eq!(kept, 2);
    assert_eq!(memory.all().unwrap().len(), 2);
}

#[test]
fn what_is_recorded_survives_reopening_the_file() {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("memory.sqlite3");
    {
        let memory = Memory::open(&path).unwrap();
        memory.record(Run { output: Some("all green".into()), ..run("cargo test") }).unwrap();
    }
    let memory = Memory::open(&path).unwrap();
    assert_eq!(memory.schema().unwrap(), MIGRATIONS.len() as i64);
    assert_eq!(texts(&find(&memory, "green")), ["cargo test"]);
}

#[test]
fn a_database_from_a_newer_jky_is_refused_rather_than_changed() {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("memory.sqlite3");
    {
        // Rollback-journal mode, as a newer build might leave it: switching to
        // WAL would itself be a write.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE future(x); PRAGMA user_version = 99;").unwrap();
    }
    let before = std::fs::read(&path).unwrap();
    match Memory::open(&path) {
        Err(MemoryError::Newer { found: 99, .. }) => {}
        Err(other) => panic!("wrong error: {other}"),
        Ok(_) => panic!("a newer database was opened"),
    }
    assert_eq!(std::fs::read(&path).unwrap(), before, "refusing it still changed it");
}

#[test]
fn escape_sequences_of_every_kind_are_removed() {
    assert_eq!(strip_escapes("\x1b[1;32mok\x1b[0m"), "ok");
    assert_eq!(strip_escapes("a\x1b]0;title\x07b"), "ab");
    assert_eq!(strip_escapes("a\x1bPq#0;2;0;0;0~\x1b\\b"), "ab", "a Sixel image is not text");
    assert_eq!(strip_escapes("50%\r100%\r\n"), "50%\n100%\n");
}

#[test]
fn shell_history_search_is_what_it_always_was() {
    // Subsequence, grouped by command, counted: `dkrps` finds `docker ps`.
    let memory = Memory::in_memory().unwrap();
    memory.record(Run { at: 1, ..run("docker ps") }).unwrap();
    memory.record(Run { at: 2, ..run("docker ps") }).unwrap();
    memory.record(Run { at: 3, ..run("git status") }).unwrap();
    let hits = memory
        .hits(&jky_history::Query { text: "dkrps".into(), ..Default::default() }, 10)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entry.command, "docker ps");
    assert_eq!(hits[0].count, 2);
}

#[test]
fn completion_gets_the_newest_commands_first() {
    let memory = Memory::in_memory().unwrap();
    for (at, c) in [(1, "a"), (2, "b"), (3, "c")] {
        memory.record(Run { at, ..run(c) }).unwrap();
    }
    assert_eq!(memory.recent_commands(2).unwrap(), ["c", "b"]);
}

#[test]
fn an_old_history_file_is_imported_once_and_then_removed() {
    let dir = tempfile::TempDir::new().unwrap();
    let file = dir.path().join("history.jsonl");
    let old = jky_history::History::new(&file);
    for command in ["make", "make test"] {
        old.record(jky_history::Entry {
            command: command.into(),
            cwd: "/w".into(),
            code: 0,
            at: 5,
            session: "p".into(),
            host: None,
        })
        .unwrap();
    }
    let memory = Memory::in_memory().unwrap();
    assert_eq!(memory.import_history(&file).unwrap(), 2);
    assert!(!file.exists(), "a second copy of every command was left behind");
    assert_eq!(memory.import_history(&file).unwrap(), 0, "nothing to import twice");
    assert_eq!(memory.count().unwrap(), 2);
}

#[test]
fn a_huge_command_is_cut_rather_than_kept_whole() {
    let memory = Memory::in_memory().unwrap();
    let id = memory.record(run(&"x".repeat(COMMAND_LIMIT * 3))).unwrap().unwrap();
    assert_eq!(memory.get(id).unwrap().command.len(), COMMAND_LIMIT);
}

#[test]
fn past_the_cap_the_oldest_unpinned_runs_go_first() {
    let mut memory = Memory::in_memory().unwrap();
    memory.cap = 3;
    let first = memory.record(Run { at: 1, ..run("first") }).unwrap().unwrap();
    memory.pin(first, true).unwrap();
    for (at, c) in [(2, "second"), (3, "third"), (4, "fourth"), (5, "fifth")] {
        memory.record(Run { at, ..run(c) }).unwrap();
    }
    let mut left = texts(&find(&memory, ""));
    left.sort();
    assert_eq!(left, ["fifth", "first", "fourth", "third"], "three unpinned, and the pinned one");
}
