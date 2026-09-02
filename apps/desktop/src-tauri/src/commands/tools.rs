//! The developer tools that live in Rust, over IPC.
//!
//! Thin wrappers, as everywhere in this directory. Every one of these is a
//! function of its arguments — no network, no filesystem, no credential — so
//! the only thing this layer adds is a bound on how much text the window may
//! hand over.
//!
//! That bound is not politeness. These commands take arbitrary text from the
//! renderer, and hashing or diffing a hundred megabytes of it would block a
//! worker thread for as long as it took. A megabyte is far more than anyone
//! pastes into a panel and far less than anyone can hurt the app with.

use jky_tools::{Diff, Hashes};

/// The most text any of these will accept, per argument.
const MAX_INPUT: usize = 1024 * 1024;

fn bounded(text: &str) -> Result<(), String> {
    if text.len() > MAX_INPUT {
        return Err("that is too much text for this tool — try a smaller piece".into());
    }
    Ok(())
}

#[tauri::command]
pub fn tools_hash(text: String) -> Result<Hashes, String> {
    bounded(&text)?;
    Ok(jky_tools::hash_all(&text))
}

#[tauri::command]
pub fn tools_diff(before: String, after: String) -> Result<Diff, String> {
    bounded(&before)?;
    bounded(&after)?;
    Ok(jky_tools::diff_lines(&before, &after))
}

#[tauri::command]
pub fn tools_yaml_to_json(text: String) -> Result<String, String> {
    bounded(&text)?;
    jky_tools::yaml_to_json(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tools_format_yaml(text: String) -> Result<String, String> {
    bounded(&text)?;
    jky_tools::format_yaml(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_more_text_than_anyone_would_paste() {
        let huge = "x".repeat(MAX_INPUT + 1);
        assert!(tools_hash(huge.clone()).is_err());
        assert!(tools_diff(huge.clone(), String::new()).is_err());
        assert!(tools_diff(String::new(), huge.clone()).is_err());
        assert!(tools_yaml_to_json(huge).is_err());
    }

    // The bound is a ceiling on abuse, not a limit anyone should meet.
    #[test]
    fn accepts_a_large_but_reasonable_paste() {
        assert!(tools_hash("y".repeat(MAX_INPUT).to_string()).is_ok());
    }

    #[test]
    fn refuses_the_second_argument_as_well_as_the_first() {
        // Checking only `before` would leave the larger of the two unbounded
        // exactly half the time.
        let huge = "x".repeat(MAX_INPUT + 1);
        assert!(tools_diff("small".to_string(), huge).is_err());
    }

    #[test]
    fn passes_a_parse_error_through_rather_than_swallowing_it() {
        let err = tools_yaml_to_json("a: [1, 2\n".to_string()).unwrap_err();
        assert!(err.contains("line"), "the position was lost: {err}");
    }
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

use jky_system::{Lookup, Machine, Proc};
use jky_audit::{AuditEvent, AuditKind};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn tools_machine(state: State<'_, AppState>) -> Result<Machine, String> {
    let mut sampler = state
        .sampler
        .lock()
        .map_err(|_| "the system readings are unavailable".to_string())?;
    Ok(sampler.machine())
}

/// Every process, arranged.
///
/// Sorted and filtered in Rust rather than in the window, because the list is
/// cut to a few hundred and cutting before sorting would hand back whatever
/// booted earliest. Sending thousands of processes over IPC so the window
/// could sort them would also be sending thousands of processes over IPC.
#[tauri::command]
pub fn tools_processes(
    state: State<'_, AppState>,
    sort: String,
    search: String,
) -> Result<Vec<Proc>, String> {
    let order = match sort.as_str() {
        "cpu" => jky_system::ProcSort::Cpu,
        "memory" => jky_system::ProcSort::Memory,
        "name" => jky_system::ProcSort::Name,
        other => return Err(format!("{other} is not an order this sorts by")),
    };
    if search.len() > 200 {
        return Err("that search is too long".into());
    }

    let mut sampler = state
        .sampler
        .lock()
        .map_err(|_| "the system readings are unavailable".to_string())?;
    Ok(jky_system::arrange(
        sampler.processes(),
        order,
        &search,
        jky_system::MAX_PROCS,
    ))
}

/// Ask a process to stop.
///
/// The one command in this file that changes anything, and the only one in
/// the developer tools that can. It is audited for that reason: ending a
/// process is the kind of thing someone should be able to find afterwards,
/// and the log is where this app records what it did on the user's behalf.
///
/// The window confirms first. That gate is in the panel rather than here
/// because it is a question for a person, and a backend that asked would have
/// nobody to ask.
#[tauri::command]
pub fn tools_end_process(state: State<'_, AppState>, pid: u32) -> Result<bool, String> {
    // The two pids that are never a mistake worth making. 0 means "every
    // process in my group" on Unix, and 1 is init — ending either takes the
    // session or the machine with it.
    if pid <= 1 {
        return Err("that is not a process this will end".into());
    }

    let mut sampler = state
        .sampler
        .lock()
        .map_err(|_| "the system readings are unavailable".to_string())?;

    let ended = sampler.end(pid);
    let _ = state.audit.append(AuditEvent::new(
        AuditKind::CommandRun,
        &format!("ended process {pid}: {}", if ended { "signalled" } else { "not found" }),
    ));
    Ok(ended)
}

#[tauri::command]
pub fn tools_resolve(host: String) -> Result<Lookup, String> {
    jky_system::resolve(&host)
}

#[tauri::command]
pub fn tools_environment() -> Vec<jky_system::EnvVar> {
    jky_system::environment()
}

/// Send one HTTP request.
///
/// The checks are in `jky_apps::http` rather than here, so the rules about
/// what may be sent live with the sending and cannot be half-applied by a
/// second caller.
#[tauri::command]
pub async fn tools_request(
    state: State<'_, AppState>,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<jky_apps::http::Response, String> {
    let request = jky_apps::http::Request { method, url, headers, body };
    jky_apps::http::check(&request)?;

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::ProviderRequest,
        &format!("http tool: {} {}", request.method, request.url),
    ));

    jky_apps::http::send(&state.http, request).await
}
