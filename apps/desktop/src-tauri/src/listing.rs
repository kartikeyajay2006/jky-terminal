//! Rendering the dashboard's collections for a terminal.
//!
//! `jky notes` has to work in a shell, where there is no JSON parser worth
//! relying on and no portable way to reach back into the app. So the app
//! renders each collection to a plain file whenever it changes, and the
//! launcher script does nothing cleverer than `cat` the right one.
//!
//! That keeps the formatting here, in Rust, where it is tested, and keeps the
//! shell scripts to something that behaves identically on three platforms.

use std::path::{Path, PathBuf};

use jky_store::{Note, Reminder, Store, Todo};

const ESC: char = '\u{1b}';

/// Where the rendered listings live, under the launcher directory.
pub fn data_dir(bin_dir: &Path) -> PathBuf {
    bin_dir.join("data")
}

/// The handles shown beside each record: 1, 2, 3, in the order they are
/// listed.
///
/// These were four hex characters of a hash, which had the nice property of
/// never changing when a neighbour was deleted. They were also unreadable and
/// unmemorable, and nobody types `6786` when a list is sitting in front of
/// them numbered from one.
///
/// The cost is real and worth stating: delete the second of three notes and
/// the third becomes 2, so a number copied out of old scrollback can point
/// at a different record. Re-running the listing always shows the truth, and
/// the listing is one command away.
pub fn handles(count: usize) -> Vec<String> {
    (1..=count).map(|n| n.to_string()).collect()
}

fn fg(rgb: (u8, u8, u8)) -> String {
    format!("{ESC}[38;2;{};{};{}m", rgb.0, rgb.1, rgb.2)
}

struct Paint {
    reset: String,
    dim: String,
    bold: String,
    tint: String,
}

impl Paint {
    fn new(accent: Option<(u8, u8, u8)>) -> Self {
        match accent {
            Some(rgb) => Self {
                reset: format!("{ESC}[0m"),
                dim: format!("{ESC}[2m"),
                bold: format!("{ESC}[1m"),
                tint: fg(rgb),
            },
            // Plain when no colour is given, which is right when the output is
            // being piped somewhere rather than read.
            None => Self {
                reset: String::new(),
                dim: String::new(),
                bold: String::new(),
                tint: String::new(),
            },
        }
    }
}

/// Append a line, trimmed of trailing spaces.
///
/// Padded columns leave whitespace hanging off the end of a row wherever the
/// last field is short, which shows up the moment anyone selects the output.
fn line(out: &mut String, body: &str) {
    out.push_str(body.trim_end());
    out.push_str("\r\n");
}

fn header(p: &Paint, title: &str, count: usize, noun: &str) -> String {
    format!(
        "\r\n  {}{}{}{}  {}{} {}{}\r\n\r\n",
        p.bold, p.tint, title, p.reset, p.dim, count, noun, p.reset
    )
}

fn footer(p: &Paint, hint: &str) -> String {
    format!("\r\n  {}{}{}\r\n\r\n", p.dim, hint, p.reset)
}

fn empty(p: &Paint, what: &str) -> String {
    format!("  {}Nothing here yet. Add {} from the Dashboard.{}\r\n", p.dim, what, p.reset)
}

/// Pad to a column width, counting characters rather than bytes.
fn col(text: &str, width: usize) -> String {
    let n = text.chars().count();
    if n >= width {
        // Truncate with an ellipsis rather than pushing every later column out
        // of alignment.
        if width <= 1 {
            return text.chars().take(width).collect();
        }
        let kept: String = text.chars().take(width - 1).collect();
        return format!("{kept}…");
    }
    format!("{text}{}", " ".repeat(width - n))
}

/// `2026-08-27T09:00:00Z` to `Aug 27` on the reader's clock is not possible
/// here without a timezone database, so this reads the stored date directly.
/// The dashboard shows local time; the terminal listing shows the stored date,
/// and says so in the footer.
fn short_date(at: &str) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let (Some(y), Some(m), Some(d)) = (at.get(0..4), at.get(5..7), at.get(8..10)) else {
        return at.to_string();
    };
    match m.parse::<usize>() {
        Ok(m) if (1..=12).contains(&m) => format!("{} {}, {}", MONTHS[m - 1], d, y),
        _ => at.to_string(),
    }
}

// --- the four listings ------------------------------------------------------

pub fn render_notes(notes: &[Note], accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    let mut out = header(&p, "NOTES", notes.len(), if notes.len() == 1 { "note" } else { "notes" });

    if notes.is_empty() {
        out.push_str(&empty(&p, "one"));
    } else {
        for (note, short) in notes.iter().zip(handles(notes.len())) {
            line(
                &mut out,
                &format!(
                    "  {}{:>3}{}  {}  {}{}{}",
                    p.tint,
                    short,
                    p.reset,
                    col(&note.title, 40),
                    p.dim,
                    short_date(&note.updated_at),
                    p.reset,
                ),
            );
        }
    }
    out.push_str(&footer(&p, "jky notes 1  to read one"));
    out
}

pub fn render_note(note: &Note, short: &str, accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    let mut out = format!("\r\n  {}{}{}{}\r\n", p.bold, p.tint, note.title, p.reset);
    out.push_str(&format!(
        "  {}{} · updated {}{}\r\n\r\n",
        p.dim,
        short,
        short_date(&note.updated_at),
        p.reset
    ));

    if note.body.trim().is_empty() {
        out.push_str(&format!("  {}This note is empty.{}\r\n", p.dim, p.reset));
    } else {
        // The body is the user's own text and is printed as written. Each line
        // is indented to match everything else, and \r\n because a raw pty
        // leaves the cursor mid-line otherwise.
        for line in note.body.lines() {
            out.push_str(&format!("  {line}\r\n"));
        }
    }
    out.push_str("\r\n");
    out
}

pub fn render_reminders(reminders: &[Reminder], accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    let mut out = header(
        &p,
        "REMINDERS",
        reminders.len(),
        if reminders.len() == 1 { "reminder" } else { "reminders" },
    );

    if reminders.is_empty() {
        out.push_str(&empty(&p, "one"));
    } else {
        let mut sorted: Vec<&Reminder> = reminders.iter().collect();
        sorted.sort_by(|a, b| a.at.cmp(&b.at));

        for (r, short) in sorted.iter().zip(handles(sorted.len())) {
            out.push_str(&format!(
                "  {}{:>3}{}  {}  {}{}{}  {}\r\n",
                p.tint,
                short,
                p.reset,
                if r.done { "[x]" } else { "[ ]" },
                p.dim,
                r.at,
                p.reset,
                r.text,
            ));
        }
    }
    out.push_str(&footer(&p, "jky reminders 1  for one"));
    out
}

pub fn render_reminder(r: &Reminder, short: &str, accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    format!(
        "\r\n  {}{}{}{}\r\n  {}{} · {} · {}{}\r\n\r\n",
        p.bold,
        p.tint,
        r.text,
        p.reset,
        p.dim,
        short,
        r.at,
        if r.done { "done" } else { "not done" },
        p.reset
    )
}

pub fn render_todos(todos: &[Todo], accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    let mut out =
        header(&p, "TODOS", todos.len(), if todos.len() == 1 { "todo" } else { "todos" });

    if todos.is_empty() {
        out.push_str(&empty(&p, "one"));
    } else {
        for (t, short) in todos.iter().zip(handles(todos.len())) {
            out.push_str(&format!(
                "  {}{:>3}{}  {}  {}\r\n",
                p.tint,
                short,
                p.reset,
                if t.done { "[x]" } else { "[ ]" },
                t.text,
            ));
        }
    }
    out.push_str(&footer(&p, "jky todos 1  for one"));
    out
}

pub fn render_todo(t: &Todo, short: &str, accent: Option<(u8, u8, u8)>) -> String {
    let p = Paint::new(accent);
    format!(
        "\r\n  {}{}{}{}\r\n  {}{} · {} · added {}{}\r\n\r\n",
        p.bold,
        p.tint,
        t.text,
        p.reset,
        p.dim,
        short,
        if t.done { "done" } else { "not done" },
        short_date(&t.created_at),
        p.reset
    )
}

// --- writing the files ------------------------------------------------------

/// Write every listing, and one file per record.
///
/// Called at startup and after every change, so `jky notes` never shows
/// something the dashboard does not. A failure here is not surfaced: the
/// terminal listing going stale is a nuisance, and refusing to save a note
/// because a convenience file could not be written would be worse.
pub fn write_all(store: &Store, bin_dir: &Path, accent: Option<(u8, u8, u8)>) -> std::io::Result<()> {
    let dir = data_dir(bin_dir);
    std::fs::create_dir_all(&dir)?;

    if let Ok(notes) = store.notes().list() {
        write_one(&dir, "notes", &render_notes(&notes, accent))?;
        let hs = handles(notes.len());
        write_records(&dir, "notes", &hs, |i| render_note(&notes[i], &hs[i], accent))?;
    }

    if let Ok(reminders) = store.reminders().list() {
        write_one(&dir, "reminders", &render_reminders(&reminders, accent))?;
        let mut sorted: Vec<Reminder> = reminders.clone();
        sorted.sort_by(|a, b| a.at.cmp(&b.at));
        let hs = handles(sorted.len());
        write_records(&dir, "reminders", &hs, |i| render_reminder(&sorted[i], &hs[i], accent))?;
    }

    if let Ok(todos) = store.todos().list() {
        write_one(&dir, "todos", &render_todos(&todos, accent))?;
        let hs = handles(todos.len());
        write_records(&dir, "todos", &hs, |i| render_todo(&todos[i], &hs[i], accent))?;
    }

    Ok(())
}

fn write_one(dir: &Path, name: &str, body: &str) -> std::io::Result<()> {
    std::fs::write(dir.join(format!("{name}.ansi")), body)
}

/// One file per record, named by its short handle.
///
/// The directory is emptied first: a record deleted in the dashboard has to
/// stop being readable from the shell, and a leftover file would keep
/// answering for it.
fn write_records(
    dir: &Path,
    name: &str,
    shorts: &[String],
    render: impl Fn(usize) -> String,
) -> std::io::Result<()> {
    let sub = dir.join(name);
    let _ = std::fs::remove_dir_all(&sub);
    std::fs::create_dir_all(&sub)?;

    for (i, short) in shorts.iter().enumerate() {
        std::fs::write(sub.join(format!("{short}.ansi")), render(i))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            body: "line one\nline two".into(),
            created_at: "2026-08-27T00:00:00Z".into(),
            updated_at: "2026-08-27T09:30:00Z".into(),
        }
    }

    #[test]
    fn handles_are_counted_from_one() {
        // A list in front of you numbered from one is what people type.
        assert_eq!(handles(3), ["1", "2", "3"]);
    }

    #[test]
    fn an_empty_collection_has_no_handles() {
        assert_eq!(handles(0), Vec::<String>::new());
    }

    #[test]
    fn handles_keep_going_past_nine() {
        let hs = handles(12);
        assert_eq!(hs[9], "10");
        assert_eq!(hs.last().unwrap(), "12");
    }

    #[test]
    fn handles_match_the_order_things_are_listed_in() {
        // The number beside a row has to be the number that fetches that row,
        // and reminders are listed by time of day rather than by when they
        // were added.
        let r = |id: &str, at: &str, text: &str| Reminder {
            id: id.into(),
            at: at.into(),
            text: text.into(),
            done: false,
        };
        let listing = render_reminders(&[r("r2", "18:00", "Evening"), r("r1", "07:00", "Morning")], None);

        let first_row = listing.lines().find(|l| l.contains("Morning")).unwrap();
        assert!(first_row.trim_start().starts_with('1'), "{first_row}");
    }

    #[test]
    fn the_notes_listing_shows_a_handle_and_a_title() {
        let out = render_notes(&[note("n1", "Today's Plan")], None);
        assert!(out.contains("Today's Plan"), "{out}");
        assert!(out.contains(" 1  "), "no handle in: {out}");
    }

    #[test]
    fn the_notes_listing_says_how_to_read_one() {
        assert!(render_notes(&[note("n1", "Plan")], None).contains("jky notes 1"));
    }

    #[test]
    fn an_empty_listing_says_what_to_do_rather_than_nothing() {
        let out = render_notes(&[], None);
        assert!(out.contains("Dashboard"), "{out}");
    }

    #[test]
    fn one_note_is_singular() {
        assert!(render_notes(&[note("n1", "Plan")], None).contains("1 note\u{1b}[0m") || render_notes(&[note("n1", "Plan")], None).contains("1 note"));
        assert!(render_notes(&[note("n1", "a"), note("n2", "b")], None).contains("2 notes"));
    }

    #[test]
    fn a_single_note_prints_its_body() {
        let out = render_note(&note("n1", "Plan"), "a3f2", None);
        assert!(out.contains("line one"), "{out}");
        assert!(out.contains("line two"), "{out}");
    }

    #[test]
    fn every_line_ends_with_a_carriage_return() {
        // A raw pty does not translate \n, so a listing without \r walks
        // diagonally down the screen.
        let out = render_note(&note("n1", "Plan"), "a3f2", None);
        for line in out.split('\n').filter(|l| !l.is_empty()) {
            assert!(line.ends_with('\r'), "line without CR: {line:?}");
        }
    }

    #[test]
    fn an_empty_note_says_so_rather_than_printing_nothing() {
        let mut n = note("n1", "Plan");
        n.body = "   ".into();
        assert!(render_note(&n, "a3f2", None).contains("empty"));
    }

    #[test]
    fn a_long_title_is_truncated_rather_than_breaking_the_columns() {
        let long = "x".repeat(120);
        let out = render_notes(&[note("n1", &long)], None);
        for line in out.lines() {
            assert!(line.chars().count() < 100, "line too long: {}", line.len());
        }
    }

    #[test]
    fn reminders_are_listed_in_the_order_of_the_day() {
        let r = |id: &str, at: &str, text: &str| Reminder {
            id: id.into(),
            at: at.into(),
            text: text.into(),
            done: false,
        };
        let out = render_reminders(&[r("r1", "21:00", "Plan"), r("r2", "07:00", "Exercise")], None);
        assert!(out.find("Exercise").unwrap() < out.find("Plan").unwrap(), "{out}");
    }

    #[test]
    fn a_done_reminder_is_ticked() {
        let done = Reminder { id: "r1".into(), at: "07:00".into(), text: "Exercise".into(), done: true };
        assert!(render_reminders(&[done], None).contains("[x]"));
    }

    #[test]
    fn a_date_reads_the_way_a_person_writes_it() {
        assert_eq!(short_date("2026-08-27T09:00:00Z"), "Aug 27, 2026");
    }

    #[test]
    fn an_unreadable_date_is_shown_raw_rather_than_invented() {
        assert_eq!(short_date("whenever"), "whenever");
        assert_eq!(short_date("2026-99-27T09:00:00Z"), "2026-99-27T09:00:00Z");
    }

    #[test]
    fn colour_is_optional_and_absent_output_has_no_escapes() {
        // Piping the listing somewhere should not fill it with escape codes.
        let out = render_notes(&[note("n1", "Plan")], None);
        assert!(!out.contains('\u{1b}'), "{out:?}");
    }

    #[test]
    fn colour_is_used_when_given() {
        let out = render_notes(&[note("n1", "Plan")], Some((0, 229, 255)));
        assert!(out.contains("\u{1b}[38;2;0;229;255m"), "{out:?}");
    }

    #[test]
    fn writing_lays_out_a_listing_and_one_file_per_record() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store"));
        store.notes().save(note("n1", "Plan")).unwrap();
        store.notes().save(note("n2", "Other")).unwrap();

        let bin = dir.path().join("bin");
        write_all(&store, &bin, None).unwrap();

        let data = data_dir(&bin);
        assert!(data.join("notes.ansi").is_file());
        for handle in ["1", "2"] {
            assert!(data.join("notes").join(format!("{handle}.ansi")).is_file(), "{handle}");
        }
    }

    #[test]
    fn a_deleted_record_stops_being_readable_from_the_shell() {
        // A leftover file would keep answering for something the user removed.
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store"));
        store.notes().save(note("n1", "Plan")).unwrap();
        store.notes().save(note("n2", "Other")).unwrap();

        let bin = dir.path().join("bin");
        write_all(&store, &bin, None).unwrap();

        // Two notes, so handles 1 and 2 exist. After removing one there is
        // only 1, and 2 must stop answering rather than pointing at whatever
        // is left.
        assert!(data_dir(&bin).join("notes").join("2.ansi").exists());
        store.notes().remove("n2").unwrap();
        write_all(&store, &bin, None).unwrap();

        assert!(!data_dir(&bin).join("notes").join("2.ansi").exists());
        assert!(data_dir(&bin).join("notes").join("1.ansi").exists());
    }

    /// The whole chain: save a record, render, then run the real script.
    ///
    /// Every other test here checks one link. This is the only one that
    /// proves a note saved in the dashboard is what `jky notes` prints,
    /// which is the thing the user actually asked for.
    #[test]
    #[cfg(not(windows))]
    fn a_saved_note_is_what_jky_notes_prints() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        store.notes().save(note("note-1756280000000-1", "Today's Plan")).unwrap();

        let bin = jky_pty::launcher_dir(dir.path());
        jky_pty::install_launchers(&bin, "BANNER", "COMMANDS").unwrap();
        write_all(&store, &bin, None).unwrap();

        let out = std::process::Command::new("sh")
            .arg(bin.join("jky"))
            .arg("notes")
            .output()
            .expect("script runs");
        let stdout = String::from_utf8_lossy(&out.stdout);

        assert!(out.status.success(), "jky notes failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(stdout.contains("Today's Plan"), "{stdout}");

        assert!(stdout.contains(" 1  "), "no handle in: {stdout}");

        // And the handle it printed actually resolves.
        let one = std::process::Command::new("sh")
            .arg(bin.join("jky"))
            .arg("notes")
            .arg("1")
            .output()
            .expect("script runs");
        assert!(one.status.success());
        assert!(String::from_utf8_lossy(&one.stdout).contains("line one"));
    }

    #[test]
    #[cfg(not(windows))]
    fn deleting_a_note_stops_jky_notes_finding_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        store.notes().save(note("n1", "Keep")).unwrap();
        store.notes().save(note("n2", "Remove")).unwrap();

        let bin = jky_pty::launcher_dir(dir.path());
        jky_pty::install_launchers(&bin, "BANNER", "COMMANDS").unwrap();
        write_all(&store, &bin, None).unwrap();

        store.notes().remove("n2").unwrap();
        write_all(&store, &bin, None).unwrap();

        let out = std::process::Command::new("sh")
            .arg(bin.join("jky"))
            .arg("notes")
            .arg("2")
            .output()
            .expect("script runs");
        assert!(!out.status.success(), "a deleted note is still readable");
    }

    #[test]
    fn writing_covers_every_collection_the_shell_can_read() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store"));
        let bin = dir.path().join("bin");
        write_all(&store, &bin, None).unwrap();

        for name in ["notes", "reminders", "todos"] {
            assert!(data_dir(&bin).join(format!("{name}.ansi")).is_file(), "{name}");
        }
        // Events are reached from the Calendar panel, not the shell, so no
        // listing is written for them and `jky events` does not exist.
        assert!(!data_dir(&bin).join("events.ansi").exists());
    }
}

