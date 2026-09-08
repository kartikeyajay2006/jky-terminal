//! The two ends of the camera.
//!
//! The window renders a picture of itself — there is no portable way to ask a
//! Tauri webview for one, and the reasoning is in
//! `docs/superpowers/specs/2026-09-09-capture-design.md` §3 — and hands the
//! PNG bytes here. What happens next is an effect on the machine, which is
//! Rust's half of the bargain.
//!
//! Neither command takes a destination. The window says *what* to keep; where
//! it goes is decided here, from the OS's own downloads directory. A command
//! that accepted a path from the renderer would be an arbitrary file write
//! with a camera painted on it, and would quietly undo the fact that the
//! window is granted no filesystem capability at all.

use jky_audit::{AuditEvent, AuditKind};
use tauri::{Manager, State};

use crate::state::AppState;

/// Seconds since the Unix epoch, for naming.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Save a capture, and answer with where it landed.
///
/// The returned path is for telling the person where to look. It is not a
/// handle to anything: nothing in the window can read it back, and no other
/// command accepts a path.
#[tauri::command]
pub fn capture_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    png: Vec<u8>,
) -> Result<String, String> {
    // Resolved by Tauri per platform: ~/Downloads, %USERPROFILE%\Downloads,
    // and the localised equivalent on macOS. Falling back to the home
    // directory is better than refusing, and better than inventing a folder.
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|_| "there is nowhere to save a capture on this machine".to_string())?;

    let path = jky_capture::save(&dir, &png, now_secs()).map_err(|e| e.to_string())?;
    let shown = path.display().to_string();

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::Captured,
        &format!("a capture was saved to {shown}"),
    ));

    Ok(shown)
}

/// Put a capture on the clipboard, and write nothing.
///
/// Returns nothing on purpose. A command that handed the clipboard back to the
/// window would be a way to read whatever the person last copied, which is
/// exactly the kind of ambient authority the window is not given.
#[tauri::command]
pub fn capture_copy(state: State<'_, AppState>, png: Vec<u8>) -> Result<(), String> {
    jky_capture::copy_to_clipboard(&png).map_err(|e| e.to_string())?;

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::Captured,
        "a capture was copied to the clipboard",
    ));

    Ok(())
}
