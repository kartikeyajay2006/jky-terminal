//! Work Memory: every command you ran, with what it printed, searchable.
//!
//! Shell history remembers what was typed. What people actually go looking for
//! a month later is the rest of it: the command that printed *that* error, the
//! deploy that ran on the `release` branch, how long the migration took, the
//! note you left on the one that finally worked. So each run is kept with its
//! folder, exit status, duration, git branch and revision, the tail of its
//! output, and an optional pin and note — and all of it is searchable.
//!
//! **Why SQLite.** History used to be a JSON-lines file read whole on every
//! search. That is fine for commands; it is not fine once each run carries
//! kilobytes of output and a search is expected to look inside it. SQLite, with
//! FTS5, answers a search over a year of runs without reading a year of runs,
//! and its transactions mean a crash mid-write loses a write rather than the
//! file. It is compiled into the binary, so every platform runs the same one.
//!
//! **What is never kept.** Everything that reaches the database goes through
//! `jky-redact` first — the command, the output and the note — so a token that
//! appeared on screen is a label here. Whether anything is kept at all, and
//! for how long, is decided by the privacy settings, in the command layer
//! that calls this; this crate does what it is told and adds no policy of its
//! own beyond refusing secrets and bounding size.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The most output kept for one run: its tail, which is where the error is.
pub const OUTPUT_LIMIT: usize = 8 * 1024;
/// The longest note a run may carry.
pub const NOTE_LIMIT: usize = 2_000;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("the work memory database could not be used: {0}")]
    Db(String),
    #[error(
        "the work memory was written by a newer JKY (schema {found}; this build knows {known}). \
         Update JKY rather than let an older one change it"
    )]
    Newer { found: i64, known: i64 },
    #[error("there is no run with that id")]
    NoSuchRun,
}

impl From<rusqlite::Error> for MemoryError {
    fn from(e: rusqlite::Error) -> Self {
        MemoryError::Db(e.to_string())
    }
}

/// One command that ran, and what is known about it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    /// Assigned when it is recorded; 0 for one that has not been.
    #[serde(default)]
    pub id: i64,
    pub command: String,
    pub cwd: String,
    pub code: i32,
    /// Milliseconds since the epoch, when it started.
    pub at: i64,
    /// The pane it ran in.
    #[serde(default)]
    pub session: String,
    /// The machine, for a remote pane; `None` for this one.
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    /// The branch checked out in `cwd` when it ran, if it was a git checkout.
    #[serde(default)]
    pub branch: Option<String>,
    /// The commit `HEAD` pointed at, abbreviated.
    #[serde(default)]
    pub rev: Option<String>,
    /// The tail of what it printed, redacted and without escape sequences.
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub note: String,
}

/// What to look for.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryQuery {
    /// Words to find in the command, its output, its note or its folder.
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub failed_only: bool,
    #[serde(default)]
    pub pinned_only: bool,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub session: Option<String>,
    #[serde(default)]
    pub limit: usize,
}

/// One result: the run, and where the words were found in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Found {
    #[serde(flatten)]
    pub run: Run,
    /// A line of output or note around the match, with the match between
    /// `\u{2}` and `\u{3}` for the window to highlight. `None` when the words
    /// were found only in the command, or nothing was searched for.
    pub snippet: Option<String>,
}

/// The schema, one step per version. Applied in order; never edited once
/// shipped — a change is a new step.
const MIGRATIONS: &[&str] = &[
    // 1: runs, and a full-text index over the parts people search.
    "CREATE TABLE runs (
        id          INTEGER PRIMARY KEY,
        command     TEXT    NOT NULL,
        cwd         TEXT    NOT NULL DEFAULT '',
        code        INTEGER NOT NULL DEFAULT 0,
        at          INTEGER NOT NULL,
        session     TEXT    NOT NULL DEFAULT '',
        host        TEXT,
        duration_ms INTEGER,
        branch      TEXT,
        rev         TEXT,
        output      TEXT,
        pinned      INTEGER NOT NULL DEFAULT 0,
        note        TEXT    NOT NULL DEFAULT ''
     );
     CREATE INDEX runs_at ON runs(at);
     CREATE INDEX runs_command ON runs(command);
     -- Trigram: a search for `uild` finds `cargo build`, the way people look
     -- for half-remembered commands. External content, so text is stored once.
     CREATE VIRTUAL TABLE runs_fts USING fts5(
        command, output, note, cwd,
        content = 'runs', content_rowid = 'id', tokenize = 'trigram'
     );
     CREATE TRIGGER runs_ai AFTER INSERT ON runs BEGIN
        INSERT INTO runs_fts(rowid, command, output, note, cwd)
        VALUES (new.id, new.command, coalesce(new.output, ''), new.note, new.cwd);
     END;
     CREATE TRIGGER runs_ad AFTER DELETE ON runs BEGIN
        INSERT INTO runs_fts(runs_fts, rowid, command, output, note, cwd)
        VALUES ('delete', old.id, old.command, coalesce(old.output, ''), old.note, old.cwd);
     END;
     CREATE TRIGGER runs_au AFTER UPDATE ON runs BEGIN
        INSERT INTO runs_fts(runs_fts, rowid, command, output, note, cwd)
        VALUES ('delete', old.id, old.command, coalesce(old.output, ''), old.note, old.cwd);
        INSERT INTO runs_fts(rowid, command, output, note, cwd)
        VALUES (new.id, new.command, coalesce(new.output, ''), new.note, new.cwd);
     END;",
];

/// The database, behind a lock: one connection, used from any thread.
pub struct Memory {
    conn: Mutex<Connection>,
}

impl Memory {
    /// Open (or create) the database at `path`, bringing its schema up to date.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, MemoryError> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent).map_err(|e| MemoryError::Db(e.to_string()))?;
        }
        Self::prepare(Connection::open(path)?)
    }

    /// A database that lives only as long as this value. For tests.
    pub fn in_memory() -> Result<Self, MemoryError> {
        Self::prepare(Connection::open_in_memory()?)
    }

    fn prepare(mut conn: Connection) -> Result<Self, MemoryError> {
        // WAL: a reader is never blocked by a writer, so a search while a
        // command is being recorded does not wait. The timeout covers a second
        // process — a `jky` command, a test — holding the lock for a moment.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let found: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let known = MIGRATIONS.len() as i64;
        if found > known {
            return Err(MemoryError::Newer { found, known });
        }
        for (step, sql) in MIGRATIONS.iter().enumerate().skip(found as usize) {
            // One transaction per step: a crash mid-migration leaves the last
            // complete version, never half of the next.
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (step + 1) as i64)?;
            tx.commit()?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic elsewhere while holding this says nothing about the database,
        // which SQLite keeps consistent on its own.
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Keep a run. Secrets are removed and output is bounded first.
    ///
    /// Returns the new id, or `None` for a run with nothing to keep — an empty
    /// command line.
    pub fn record(&self, run: Run) -> Result<Option<i64>, MemoryError> {
        let run = clean(run);
        if run.command.is_empty() {
            return Ok(None);
        }
        let conn = self.conn();
        insert(&conn, &run)?;
        Ok(Some(conn.last_insert_rowid()))
    }

    /// Keep many runs at once, in one transaction — an import.
    pub fn import(&self, runs: impl IntoIterator<Item = Run>) -> Result<usize, MemoryError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let mut kept = 0;
        for run in runs {
            let run = clean(run);
            if !run.command.is_empty() {
                insert(&tx, &run)?;
                kept += 1;
            }
        }
        tx.commit()?;
        Ok(kept)
    }

    /// Runs matching a query: the newest first, or the best matches first when
    /// there are words to match.
    pub fn search(&self, query: &MemoryQuery) -> Result<Vec<Found>, MemoryError> {
        let limit = if query.limit == 0 { 200 } else { query.limit.min(2_000) } as i64;
        let words: Vec<&str> = query.text.split_whitespace().collect();
        // Trigrams need three characters; a shorter word is matched as a plain
        // substring instead, so typing `ls` still finds something.
        let (long, short): (Vec<&str>, Vec<&str>) = words.iter().partition(|w| w.chars().count() >= 3);

        let mut sql = format!("SELECT {COLUMNS}");
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if long.is_empty() {
            sql.push_str(", NULL FROM runs r WHERE 1 = 1");
        } else {
            // The snippet comes from output (column 1) or, failing that, the
            // note (column 2): the command itself is shown whole anyway.
            sql.push_str(
                ", CASE
                     WHEN instr(lower(coalesce(r.output, '')), lower(?1)) > 0
                       THEN snippet(runs_fts, 1, char(2), char(3), '…', 12)
                     WHEN instr(lower(r.note), lower(?1)) > 0
                       THEN snippet(runs_fts, 2, char(2), char(3), '…', 12)
                   END
                 FROM runs_fts JOIN runs r ON r.id = runs_fts.rowid
                 WHERE runs_fts MATCH ?2",
            );
            args.push(long[0].to_string().into());
            args.push(fts_query(&long).into());
        }
        for word in &short {
            sql.push_str(&format!(
                " AND (instr(lower(r.command), lower(?{n})) > 0 OR instr(lower(coalesce(r.output, '')), lower(?{n})) > 0 \
                  OR instr(lower(r.note), lower(?{n})) > 0)",
                n = args.len() + 1
            ));
            args.push(word.to_string().into());
        }
        if query.failed_only {
            sql.push_str(" AND r.code != 0");
        }
        if query.pinned_only {
            sql.push_str(" AND r.pinned = 1");
        }
        if let Some(cwd) = &query.cwd {
            sql.push_str(&format!(" AND r.cwd = ?{}", args.len() + 1));
            args.push(cwd.clone().into());
        }
        if let Some(session) = &query.session {
            sql.push_str(&format!(" AND r.session = ?{}", args.len() + 1));
            args.push(session.clone().into());
        }
        if long.is_empty() {
            sql.push_str(" ORDER BY r.pinned DESC, r.at DESC");
        } else {
            sql.push_str(" ORDER BY r.pinned DESC, bm25(runs_fts), r.at DESC");
        }
        sql.push_str(&format!(" LIMIT ?{}", args.len() + 1));
        args.push(limit.into());

        let conn = self.conn();
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(rusqlite::params_from_iter(args), |r| {
            Ok(Found { run: read_run(r)?, snippet: r.get(13)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Every run, oldest first — for the shell-history views built on top.
    pub fn all(&self) -> Result<Vec<Run>, MemoryError> {
        let conn = self.conn();
        let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM runs r ORDER BY r.at, r.id"))?;
        let rows = statement.query_map([], read_run)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Pin a run, so it comes first and survives retention, or unpin it.
    pub fn pin(&self, id: i64, pinned: bool) -> Result<(), MemoryError> {
        let changed = self.conn().execute("UPDATE runs SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id])?;
        if changed == 0 {
            return Err(MemoryError::NoSuchRun);
        }
        Ok(())
    }

    /// Leave a note on a run. Redacted and bounded, like everything else.
    pub fn note(&self, id: i64, note: &str) -> Result<(), MemoryError> {
        let note = bounded(&jky_redact::redact(note.trim()).text, NOTE_LIMIT, false);
        let changed = self.conn().execute("UPDATE runs SET note = ?1 WHERE id = ?2", params![note, id])?;
        if changed == 0 {
            return Err(MemoryError::NoSuchRun);
        }
        Ok(())
    }

    /// Forget one run.
    pub fn forget(&self, id: i64) -> Result<(), MemoryError> {
        self.conn().execute("DELETE FROM runs WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Forget every run of exactly this command. Returns how many went.
    pub fn forget_command(&self, command: &str) -> Result<usize, MemoryError> {
        Ok(self.conn().execute("DELETE FROM runs WHERE command = ?1", params![command.trim()])?)
    }

    /// Forget runs older than `cutoff` (milliseconds) — except pinned ones,
    /// which are kept because someone asked for them to be.
    pub fn prune_older_than(&self, cutoff: i64) -> Result<usize, MemoryError> {
        Ok(self.conn().execute("DELETE FROM runs WHERE at < ?1 AND pinned = 0", params![cutoff])?)
    }

    /// Forget everything, pinned runs included.
    pub fn clear(&self) -> Result<(), MemoryError> {
        let conn = self.conn();
        conn.execute("DELETE FROM runs", [])?;
        // Reclaim the space, so cleared means gone from the file too.
        conn.execute_batch("INSERT INTO runs_fts(runs_fts) VALUES ('rebuild'); VACUUM;")?;
        Ok(())
    }

    pub fn count(&self) -> Result<usize, MemoryError> {
        Ok(self.conn().query_row("SELECT count(*) FROM runs", [], |r| r.get::<_, i64>(0))? as usize)
    }

    /// One run, by id.
    pub fn get(&self, id: i64) -> Result<Run, MemoryError> {
        self.conn()
            .query_row(&format!("SELECT {COLUMNS} FROM runs r WHERE r.id = ?1"), params![id], read_run)
            .optional()?
            .ok_or(MemoryError::NoSuchRun)
    }

    /// The schema version on disk.
    pub fn schema(&self) -> Result<i64, MemoryError> {
        Ok(self.conn().query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    /// Whether any run of this exact command is kept.
    pub fn knows(&self, command: &str) -> Result<bool, MemoryError> {
        Ok(self
            .conn()
            .query_row("SELECT 1 FROM runs WHERE command = ?1 LIMIT 1", params![command], |_| Ok(()))
            .optional()?
            .is_some())
    }
}

/// The columns of a run, in the order `read_run` reads them.
const COLUMNS: &str = "r.id, r.command, r.cwd, r.code, r.at, r.session, r.host, r.duration_ms, \
                       r.branch, r.rev, r.output, r.pinned, r.note";

fn read_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<Run> {
    Ok(Run {
        id: r.get(0)?,
        command: r.get(1)?,
        cwd: r.get(2)?,
        code: r.get(3)?,
        at: r.get(4)?,
        session: r.get(5)?,
        host: r.get(6)?,
        duration_ms: r.get(7)?,
        branch: r.get(8)?,
        rev: r.get(9)?,
        output: r.get(10)?,
        pinned: r.get::<_, i64>(11)? != 0,
        note: r.get(12)?,
    })
}

fn insert(conn: &Connection, run: &Run) -> Result<(), MemoryError> {
    conn.execute(
        "INSERT INTO runs (command, cwd, code, at, session, host, duration_ms, branch, rev, output, pinned, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            run.command,
            run.cwd,
            run.code,
            run.at,
            run.session,
            run.host,
            run.duration_ms,
            run.branch,
            run.rev,
            run.output,
            run.pinned as i64,
            run.note,
        ],
    )?;
    Ok(())
}

/// Redact and bound everything a run carries before it is stored.
fn clean(mut run: Run) -> Run {
    run.command = jky_redact::redact(run.command.trim()).text;
    run.note = bounded(&jky_redact::redact(run.note.trim()).text, NOTE_LIMIT, false);
    run.output = run
        .output
        .map(|o| strip_escapes(&o))
        .map(|o| jky_redact::redact(&o).text)
        .map(|o| bounded(o.trim_end(), OUTPUT_LIMIT, true))
        .filter(|o| !o.trim().is_empty());
    run.duration_ms = run.duration_ms.filter(|d| *d >= 0);
    run
}

/// At most `limit` bytes, cut on a character boundary — keeping the end when
/// `tail` is set, because the end of output is where the error is.
fn bounded(text: &str, limit: usize, tail: bool) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    if tail {
        let mut start = text.len() - limit;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        // Start on a whole line where there is one close by.
        let from = text[start..].find('\n').filter(|n| *n < 200).map(|n| start + n + 1).unwrap_or(start);
        text[from..].to_string()
    } else {
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text[..end].to_string()
    }
}

/// Terminal output without its escape sequences: colours, cursor movement,
/// titles and hyperlinks are how it looked, not what it said.
pub fn strip_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.next() {
                // CSI: parameters, then one final byte in @..~.
                Some('[') => {
                    for n in chars.by_ref() {
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                // OSC, DCS, APC, PM, SOS: until BEL or ESC \.
                Some(']') | Some('P') | Some('_') | Some('^') | Some('X') => {
                    while let Some(n) = chars.next() {
                        if n == '\x07' {
                            break;
                        }
                        if n == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                // A two-character escape: nothing more to skip.
                _ => {}
            },
            '\r' => {
                // A lone carriage return redraws the line; keep the newline only.
                if chars.peek() != Some(&'\n') {
                    out.push('\n');
                }
            }
            '\x07' | '\x08' | '\x00' => {}
            c => out.push(c),
        }
    }
    out
}

/// A user's words as an FTS5 query: every word must appear, as a substring.
///
/// Each word is quoted, so nothing typed is read as FTS syntax — `OR`, `NOT`,
/// a column filter or a stray quote is text to find, never an operator.
fn fts_query(words: &[&str]) -> String {
    words
        .iter()
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[cfg(test)]
mod tests;
