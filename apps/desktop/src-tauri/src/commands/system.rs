//! What the machine is doing, over IPC.
//!
//! A thin wrapper, as everywhere in this directory: the reading lives in
//! `jky-system` where it is testable without launching a window, and the only
//! thing here is the sampler's lifetime. It has to outlive the call, because
//! processor usage and network rates are differences between two moments and
//! something has to be the earlier one.
//!
//! It takes no arguments and reads nothing of the user's — no paths, no
//! processes, no command lines. Seven numbers about this computer, which is
//! the narrowest thing that can answer "is it the machine or is it me".

use jky_system::Status;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn system_status(state: State<'_, AppState>) -> Result<Status, String> {
    let mut sampler = state
        .sampler
        .lock()
        .map_err(|_| "the system readings are unavailable".to_string())?;
    Ok(sampler.sample())
}
