use std::io::Read;

use jky_pty::{
    PtySession, SpawnConfig, default_shell, home_dir, install_launchers, launcher_dir,
    resolve_start_dir,
};
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
    banner: String,
) -> Result<String, String> {
    // Never current_dir(): that is wherever the binary was launched from,
    // which is the project folder in development and something arbitrary from
    // an installed shortcut. A configured directory wins, then home.
    let configured = state.settings.terminal_start_dir().unwrap_or(None);
    let cwd = resolve_start_dir(configured.as_deref(), home_dir());

    // Refresh on every spawn so the banner the command prints matches the
    // theme that was active when this terminal opened. A failure here must
    // not stop a terminal from starting — the shell is the feature, the
    // convenience command is not.
    let bin_dir = launcher_dir(&state.config_dir);
    let launchers_ok = install_launchers(&bin_dir, &banner).is_ok();

    let session = PtySession::spawn(SpawnConfig {
        shell: default_shell(),
        cwd,
        cols,
        rows,
        path_prepend: launchers_ok.then_some(bin_dir),
    })
    .map_err(|e| e.to_string())?;

    // Deliberately does NOT start reading yet. The shell prints its prompt the
    // moment it starts, and the frontend cannot subscribe until it knows this
    // id — so anything read before then would be emitted to nobody and the
    // first prompt would vanish. The pty's own buffer holds that output until
    // pty_attach starts the pump.
    let _ = &app;
    Ok(state.ptys.insert(session))
}

/// Begin streaming a session's output.
///
/// Called once, after the frontend has subscribed to this session's event.
/// Splitting this from spawn is what stops the shell's first prompt being
/// emitted before anything is listening.
#[tauri::command]
pub fn pty_attach(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let session = state.ptys.get(&id).ok_or_else(|| format!("no pty '{id}'"))?;
    let mut reader = session.take_reader().map_err(|e| e.to_string())?;

    // One pump thread per session. Reading a pty blocks, so it cannot live on
    // the async runtime; the thread ends when the pty closes and read returns 0.
    let event = data_event(&id);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let payload = PtyChunk { id: id.clone(), chunk };
                    if app.emit(&event, payload).is_err() {
                        break; // the window is gone; stop pumping
                    }
                }
            }
        }
    });

    Ok(())
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
