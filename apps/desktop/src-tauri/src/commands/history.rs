use jky_history::{Hit, Query};
use jky_memory::{git_state, Memory, Run};
use jky_settings::Privacy;
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

/// The cutoff, in milliseconds since the epoch, for a retention window.
pub(crate) fn cutoff(privacy: &Privacy, now: i64) -> Option<i64> {
    (privacy.history_days > 0).then(|| now - i64::from(privacy.history_days) * 86_400_000)
}

/// Keep a finished command in Work Memory, if history is on.
///
/// The branch and commit are read here, from the folder's `.git`, for a
/// command that ran on this machine. A remote pane's folder is a path on
/// another machine, and reading it here would describe whatever happens to
/// share its name on this one.
pub(crate) fn record_logic(memory: &Memory, privacy: &Privacy, mut run: Run) -> Result<(), String> {
    // Off means off: decided here, whatever the window sends.
    if !privacy.keep_history {
        return Ok(());
    }
    if run.host.is_none() && !run.cwd.is_empty() {
        let (branch, rev) = git_state(std::path::Path::new(&run.cwd));
        run.branch = branch;
        run.rev = rev;
    }
    // An empty command line — Enter at an empty prompt — is simply not kept.
    memory.record(run).map(|_| ()).map_err(|e| e.to_string())
}

pub(crate) fn search_logic(
    memory: &Memory,
    privacy: &Privacy,
    query: &Query,
    now: i64,
) -> Result<Vec<Hit>, String> {
    // Retention is applied before every search, so nothing older than the
    // window is ever shown — and the disk is pruned as a side effect of the
    // one moment someone looks.
    if let Some(cutoff) = cutoff(privacy, now) {
        memory.prune_older_than(cutoff).map_err(|e| e.to_string())?;
    }
    memory.hits(query, now).map_err(|e| e.to_string())
}

// --- IPC surface ------------------------------------------------------------

/// Add one finished command.
///
/// The command, folder and status come from the shell's own completion
/// report; how long it took and what it printed, from the terminal that
/// watched it run. Everything is redacted and bounded before it is stored.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn history_record(
    state: State<'_, AppState>,
    command: String,
    cwd: String,
    code: i32,
    at: i64,
    session: String,
    host: Option<String>,
    duration_ms: Option<i64>,
    output: Option<String>,
) -> Result<(), String> {
    let privacy = state.settings.privacy().unwrap_or_default();
    record_logic(
        state.memory.as_ref(),
        &privacy,
        Run { command, cwd, code, at, session, host, duration_ms, output, ..Default::default() },
    )
}

#[tauri::command]
pub fn history_search(
    state: State<'_, AppState>,
    text: String,
    session: Option<String>,
    cwd: Option<String>,
    failed_only: bool,
    limit: usize,
    now: i64,
) -> Result<Vec<Hit>, String> {
    let query = Query { text, session, cwd, failed_only, limit };
    let privacy = state.settings.privacy().unwrap_or_default();
    search_logic(state.memory.as_ref(), &privacy, &query, now)
}

/// Forget every run of one command.
#[tauri::command]
pub fn history_forget(state: State<'_, AppState>, command: String) -> Result<usize, String> {
    state.memory.forget_command(&command).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.memory.clear().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;
    const KEEP: Privacy = Privacy { keep_history: true, history_days: 0, keep_scrollback: true };

    fn memory() -> Memory {
        Memory::in_memory().unwrap()
    }

    fn run(command: &str) -> Run {
        Run {
            command: command.into(),
            cwd: "/home/k".into(),
            at: NOW,
            session: "pane-1".into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_recorded_command_is_searchable() {
        let m = memory();
        record_logic(&m, &KEEP, run("docker ps")).unwrap();

        let hits =
            search_logic(&m, &KEEP, &Query { text: "dkrps".into(), ..Default::default() }, NOW).unwrap();
        assert_eq!(hits[0].entry.command, "docker ps");
    }

    #[test]
    fn an_empty_command_is_ignored_rather_than_reported() {
        // The window sends every completion the shell reports, and pressing
        // Enter at an empty prompt is one of them.
        let m = memory();
        record_logic(&m, &KEEP, run("  ")).unwrap();
        assert_eq!(m.count().unwrap(), 0);
    }

    #[test]
    fn searching_an_empty_history_finds_nothing_rather_than_failing() {
        assert!(search_logic(&memory(), &KEEP, &Query::default(), NOW).unwrap().is_empty());
    }

    #[test]
    fn nothing_is_recorded_while_history_is_off() {
        // Enforced here, not in the window: a setting that is off stays off
        // whatever the renderer sends.
        let m = memory();
        let off = Privacy { keep_history: false, ..KEEP };
        record_logic(&m, &off, run("ssh prod")).unwrap();
        assert_eq!(m.count().unwrap(), 0);
    }

    #[test]
    fn search_never_shows_what_is_older_than_the_retention_window() {
        let m = memory();
        let mut old = run("old command");
        old.at = NOW - 40 * DAY;
        record_logic(&m, &KEEP, old).unwrap();
        record_logic(&m, &KEEP, run("new command")).unwrap();

        let month = Privacy { history_days: 30, ..KEEP };
        let hits = search_logic(&m, &month, &Query::default(), NOW).unwrap();
        let found: Vec<&str> = hits.iter().map(|hit| hit.entry.command.as_str()).collect();
        assert_eq!(found, ["new command"]);
        assert_eq!(m.count().unwrap(), 1, "the old entry was not pruned from disk");
    }

    #[test]
    fn a_local_run_records_the_branch_it_ran_on() {
        let repo = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(repo.path().join(".git/refs/heads")).unwrap();
        std::fs::write(repo.path().join(".git/HEAD"), "ref: refs/heads/release\n").unwrap();
        std::fs::write(repo.path().join(".git/refs/heads/release"), "2b20c307380672ded807e8e89789651d3a0ecb30").unwrap();

        let m = memory();
        record_logic(&m, &KEEP, Run { cwd: repo.path().display().to_string(), ..run("make deploy") }).unwrap();
        let kept = &m.all().unwrap()[0];
        assert_eq!(kept.branch.as_deref(), Some("release"));
        assert_eq!(kept.rev.as_deref(), Some("2b20c30"));
    }

    #[test]
    fn a_remote_run_is_never_described_by_a_folder_on_this_machine() {
        let repo = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();
        std::fs::write(repo.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();

        let m = memory();
        let remote = Run { cwd: repo.path().display().to_string(), host: Some("prod".into()), ..run("ls") };
        record_logic(&m, &KEEP, remote).unwrap();
        assert_eq!(m.all().unwrap()[0].branch, None);
    }

    #[test]
    fn duration_and_output_are_kept_with_the_run() {
        let m = memory();
        record_logic(
            &m,
            &KEEP,
            Run { duration_ms: Some(1_250), output: Some("\x1b[32mok\x1b[0m\n".into()), ..run("cargo test") },
        )
        .unwrap();
        let kept = &m.all().unwrap()[0];
        assert_eq!(kept.duration_ms, Some(1_250));
        assert_eq!(kept.output.as_deref(), Some("ok"));
    }
}
