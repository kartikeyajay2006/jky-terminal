//! What a terminal had on screen, kept across a restart.
//!
//! # Why this is not a collection
//!
//! Everything else in this crate is governed by one rule, stated by the user
//! and taken literally: nothing gets removed until you remove it. A note you
//! wrote in March is not less yours in August, so notes, todos, events and
//! reminders are never pruned, capped or expired.
//!
//! Scrollback is the one thing here that rule should *not* cover, and saying
//! why is worth more than the code below.
//!
//! A note is something you wrote. Scrollback is something a program printed —
//! `cargo build` output, a `yes | head -100000`, a log tail. It is not
//! authored, it is emitted, and it is emitted without limit. A terminal that
//! kept all of it would grow without bound on disk for content nobody chose
//! to keep, and the one time that matters is exactly when it hurts: the
//! session where something went wrong and printed a hundred megabytes.
//!
//! So this is a rolling window, capped, and stored well away from the
//! collections so the distinction cannot blur. What it promises is narrow and
//! honest: *the last part of what was on screen*, not *everything that ever
//! happened*.

use std::path::{Path, PathBuf};

/// How much of one terminal is kept.
///
/// Bytes rather than lines, because a line has no bound — one `printf` can
/// emit a megabyte without a newline, and a line cap would then be no cap at
/// all. 256 KiB is roughly a few thousand ordinary terminal lines, which is
/// more than anyone scrolls back through and small enough that twenty tabs
/// cost single-digit megabytes.
pub const MAX_BYTES: usize = 256 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ScrollbackError {
    #[error("that is not a usable terminal name")]
    BadKey,
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

/// Where one terminal's scrollback lives.
///
/// The key is validated rather than escaped: a name that has to be escaped to
/// be safe is a name this should refuse, and refusing is far easier to be sure
/// about than escaping.
fn path_for(dir: &Path, key: &str) -> Result<PathBuf, ScrollbackError> {
    if !is_safe_key(key) {
        return Err(ScrollbackError::BadKey);
    }
    Ok(dir.join(format!("{key}.txt")))
}

/// A key is a terminal's own identifier, so it looks like `tab-3`.
///
/// Anything else — a separator, a dot, an empty string — is refused. This is
/// the whole defence against a key being used to write outside the directory.
pub fn is_safe_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Where all scrollback lives, beside the collections but not among them.
pub fn scrollback_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("scrollback")
}

/// Save one terminal's scrollback, keeping only the tail.
///
/// The cut is at a line boundary where one can be found, so a restored
/// terminal does not open mid-escape-sequence and paint garbage.
pub fn save(config_dir: &Path, key: &str, text: &str) -> Result<(), ScrollbackError> {
    let dir = scrollback_dir(config_dir);
    let path = path_for(&dir, key)?;
    std::fs::create_dir_all(&dir)?;

    let kept = tail(text, MAX_BYTES);

    // Written through a temporary and renamed, matching every other write in
    // this crate: an interrupted save leaves the previous scrollback intact
    // rather than a half-written one that would replay as noise.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, kept.as_bytes())?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Read one terminal's scrollback. A terminal that has none is not an error.
pub fn load(config_dir: &Path, key: &str) -> Result<String, ScrollbackError> {
    let path = path_for(&scrollback_dir(config_dir), key)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

/// Forget one terminal's scrollback. Closing a tab is removing it.
pub fn forget(config_dir: &Path, key: &str) -> Result<(), ScrollbackError> {
    let path = path_for(&scrollback_dir(config_dir), key)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Drop every saved scrollback that is not for one of `keep`.
///
/// Called with the tabs that actually exist, so a tab closed while the app was
/// not running does not leave its scrollback on disk for ever.
pub fn prune(config_dir: &Path, keep: &[String]) -> Result<(), ScrollbackError> {
    let dir = scrollback_dir(config_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(());
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "txt") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !keep.iter().any(|k| k == stem) {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

/// The last `max` bytes, cut at a line boundary where one is close enough.
///
/// A blind byte cut can land inside a multi-byte character or halfway through
/// an escape sequence, either of which paints as rubbish when replayed. So the
/// cut moves forward to the next newline — but only if one is nearby, because
/// a single enormous line has no boundary to find and dropping all of it would
/// be worse than a slightly ragged start.
pub fn tail(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }

    let start = text.len() - max;
    // Move forward to a character boundary first, so the slice is always valid
    // UTF-8 even when no newline is found.
    let mut cut = start;
    while cut < text.len() && !text.is_char_boundary(cut) {
        cut += 1;
    }

    // Then prefer a line boundary within the next few kilobytes.
    const LOOKAHEAD: usize = 4096;
    let window_end = (cut + LOOKAHEAD).min(text.len());
    if let Some(nl) = text[cut..window_end].find('\n') {
        cut += nl + 1;
    }

    &text[cut..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn a_terminal_with_no_history_is_not_an_error() {
        // A first run is not a failure.
        let d = dir();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "");
    }

    #[test]
    fn what_was_saved_comes_back() {
        let d = dir();
        save(d.path(), "tab-1", "hello\nworld\n").unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "hello\nworld\n");
    }

    #[test]
    fn each_terminal_is_kept_apart() {
        let d = dir();
        save(d.path(), "tab-1", "first").unwrap();
        save(d.path(), "tab-2", "second").unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "first");
        assert_eq!(load(d.path(), "tab-2").unwrap(), "second");
    }

    #[test]
    fn saving_again_replaces_rather_than_appends() {
        let d = dir();
        save(d.path(), "tab-1", "old").unwrap();
        save(d.path(), "tab-1", "new").unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "new");
    }

    #[test]
    fn closing_a_tab_forgets_it() {
        let d = dir();
        save(d.path(), "tab-1", "gone soon").unwrap();
        forget(d.path(), "tab-1").unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "");
    }

    #[test]
    fn forgetting_something_that_was_never_saved_is_fine() {
        let d = dir();
        assert!(forget(d.path(), "tab-9").is_ok());
    }

    #[test]
    fn it_lives_beside_the_collections_rather_than_among_them() {
        // The distinction this file exists to make, asserted rather than only
        // described: scrollback is capped, the collections are not, and the
        // two must not end up in the same directory where that could blur.
        let d = dir();
        save(d.path(), "tab-1", "x").unwrap();
        assert!(scrollback_dir(d.path()).is_dir());
        assert!(!d.path().join("tab-1.txt").exists());
    }

    #[test]
    fn a_write_interrupted_leaves_no_temporary_behind() {
        let d = dir();
        save(d.path(), "tab-1", "x").unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(scrollback_dir(d.path()))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    // --- the cap ---

    #[test]
    fn short_output_is_kept_whole() {
        assert_eq!(tail("hello", 100), "hello");
    }

    #[test]
    fn long_output_is_cut_to_the_cap() {
        let long = "x".repeat(1000);
        assert!(tail(&long, 100).len() <= 100);
    }

    #[test]
    fn the_cut_keeps_the_end_rather_than_the_start() {
        // The last thing printed is the interesting thing.
        let text = format!("{}TAIL", "x".repeat(1000));
        assert!(tail(&text, 100).ends_with("TAIL"));
    }

    #[test]
    fn the_cut_prefers_a_line_boundary() {
        // A restored terminal must not open mid-escape-sequence.
        let text = format!("{}\nsecond line\nthird line\n", "x".repeat(1000));
        let kept = tail(&text, 40);
        assert!(!kept.starts_with('x'), "cut mid-line: {kept:?}");
    }

    #[test]
    fn a_single_enormous_line_is_still_cut() {
        // No boundary to find, and dropping all of it would be worse than a
        // ragged start.
        let text = "y".repeat(20_000);
        let kept = tail(&text, 1000);
        assert!(!kept.is_empty());
        assert!(kept.len() <= 1000 + 4096);
    }

    #[test]
    fn the_cut_never_lands_inside_a_character() {
        // A blind byte cut through a multi-byte character paints as rubbish.
        let text = "é".repeat(4000);
        let kept = tail(&text, 1000);
        assert!(kept.chars().all(|c| c == 'é'), "cut through a character");
    }

    #[test]
    fn saving_more_than_the_cap_stores_only_the_cap() {
        let d = dir();
        let huge = "line\n".repeat(200_000);
        save(d.path(), "tab-1", &huge).unwrap();

        let back = load(d.path(), "tab-1").unwrap();
        assert!(back.len() <= MAX_BYTES, "kept {} bytes", back.len());
        assert!(back.ends_with("line\n"));
    }

    #[test]
    fn the_cap_is_big_enough_to_be_useful_and_small_enough_to_be_free() {
        // A few thousand ordinary lines; twenty tabs in single-digit
        // megabytes. A const block, because both sides are constants and
        // clippy is right that a runtime assert on them proves nothing at
        // runtime — this fails to compile instead.
        const { assert!(MAX_BYTES >= 64 * 1024) };
        const { assert!(MAX_BYTES <= 1024 * 1024) };
    }

    // --- keys ---

    #[test]
    fn an_ordinary_tab_name_is_accepted() {
        for key in ["tab-1", "tab-42", "a_b-9", "T1"] {
            assert!(is_safe_key(key), "refused {key}");
        }
    }

    #[test]
    fn a_key_that_could_escape_the_directory_is_refused() {
        // The whole defence: refused rather than escaped, because refusing is
        // far easier to be sure about.
        for key in [
            "..",
            "../../etc/passwd",
            "a/b",
            "a\\b",
            "a.txt",
            "",
            "tab 1",
            "tab\0",
        ] {
            assert!(!is_safe_key(key), "accepted {key}");
        }
    }

    #[test]
    fn an_absurdly_long_key_is_refused() {
        assert!(!is_safe_key(&"a".repeat(200)));
    }

    #[test]
    fn saving_under_a_bad_key_fails_rather_than_writing_somewhere_else() {
        let d = dir();
        assert!(matches!(
            save(d.path(), "../escaped", "x"),
            Err(ScrollbackError::BadKey)
        ));
        assert!(!d.path().join("../escaped.txt").exists());
    }

    // --- pruning ---

    #[test]
    fn pruning_drops_what_no_tab_is_using() {
        // A tab closed while the app was not running would otherwise leave its
        // scrollback on disk for ever.
        let d = dir();
        save(d.path(), "tab-1", "keep").unwrap();
        save(d.path(), "tab-2", "drop").unwrap();

        prune(d.path(), &["tab-1".to_string()]).unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "keep");
        assert_eq!(load(d.path(), "tab-2").unwrap(), "");
    }

    #[test]
    fn pruning_with_nothing_to_keep_clears_everything() {
        let d = dir();
        save(d.path(), "tab-1", "x").unwrap();
        prune(d.path(), &[]).unwrap();
        assert_eq!(load(d.path(), "tab-1").unwrap(), "");
    }

    #[test]
    fn pruning_a_directory_that_does_not_exist_yet_is_fine() {
        let d = dir();
        assert!(prune(d.path(), &["tab-1".to_string()]).is_ok());
    }
}
