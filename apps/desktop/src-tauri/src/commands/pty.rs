use std::io::Read;

use jky_pty::{PtySession, SpawnConfig, default_shell, home_dir, resolve_start_dir};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

#[derive(Clone, Serialize)]
struct PtyChunk {
    id: String,
    chunk: String,
}

/// Event name carrying output for one session. Per-session rather than one
/// global channel, so a terminal only wakes for its own bytes.
fn data_event(id: &str) -> String {
    format!("pty:data:{id}")
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    // Never current_dir(): that is wherever the binary was launched from,
    // which is the project folder in development and something arbitrary from
    // an installed shortcut. A configured directory wins, then home.
    let configured = state.settings.terminal_start_dir().unwrap_or(None);
    let cwd = resolve_start_dir(configured.as_deref(), home_dir());

    let session = PtySession::spawn(SpawnConfig {
        shell: default_shell(),
        cwd,
        cols,
        rows,
    })
    .map_err(|e| e.to_string())?;

    let mut reader = session.take_reader().map_err(|e| e.to_string())?;
    let id = state.ptys.insert(session);

    // One pump thread per session. Reading a pty blocks, so it cannot live on
    // the async runtime; the thread ends when the pty closes and read returns 0.
    let event = data_event(&id);
    let id_for_thread = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let payload = PtyChunk { id: id_for_thread.clone(), chunk };
                    if app.emit(&event, payload).is_err() {
                        break; // the window is gone; stop pumping
                    }
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let session = state.ptys.get(&id).ok_or_else(|| format!("no pty '{id}'"))?;
    session.write(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.ptys.get(&id).ok_or_else(|| format!("no pty '{id}'"))?;
    session.resize(cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.ptys.remove(&id);
    Ok(()) // killing an already-dead pty is the desired end state
}
