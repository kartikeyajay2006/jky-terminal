//! GitHub, over IPC.
//!
//! The device flow in three commands — configure, start, poll — plus the panel
//! load. Thin wrappers, as everywhere in this directory: the flow itself lives
//! in `jky-apps`, testable without launching a window.
//!
//! Two things never cross to the renderer. The **device code** is the
//! credential that redeems the token, so it is held in `AppState` for the
//! length of the flow and the window is given only the short code a person
//! types and the address to type it at. The **access token** is written
//! straight to the OS keychain by Rust; the window is told whether one exists
//! and never what it is. That is one step stricter than the Anthropic key,
//! which the window at least has to accept from a paste.

use jky_apps::github::{self, DeviceStart, PollOutcome, Summary};
use jky_audit::{AuditEvent, AuditKind};
use jky_secrets::Secret;
use serde::Serialize;
use tauri::State;

use crate::state::{AppState, PendingDevice};

/// What the panel needs to know before it can show anything.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GitHubStatus {
    /// Whether an OAuth client id has been set. Without one there is no app
    /// to authorise against, and the panel has to say so rather than fail.
    pub configured: bool,
    /// Whether a token is in the keychain. Never the token itself.
    pub connected: bool,
}

/// How far the sign-in has got.
///
/// A flat tag rather than a bare string, so the window cannot mistake one
/// state for another by spelling.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum ConnectState {
    /// Still waiting for the person to approve on github.com.
    Pending { interval_s: u64 },
    Connected { login: String },
    Denied,
    Expired,
}

/// A client id, checked before it is stored.
///
/// GitHub's ids are short and alphanumeric. The bound exists so a pasted
/// document becomes a refusal rather than a settings file with an essay in it.
fn check_client_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > 128 {
        return Err("that does not look like a client id".into());
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err("a client id is letters, digits, dots, dashes and underscores".into());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn apps_github_set_client_id(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let checked = check_client_id(&id)?;
    state
        .settings
        .set_github_client_id(&checked)
        .map_err(|e| format!("could not save that: {e}"))
}

/// The OAuth app to sign in against: whatever was stored, or the one that
/// ships with the build.
///
/// The default is what lets someone sign in the moment they install this,
/// rather than having to register an OAuth app of their own first. A stored
/// value still wins, so running against your own app stays possible.
fn client_id(state: &AppState) -> String {
    state
        .settings
        .github_client_id()
        .ok()
        .flatten()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| github::DEFAULT_CLIENT_ID.to_string())
}

#[tauri::command]
pub fn apps_github_status(state: State<'_, AppState>) -> GitHubStatus {
    GitHubStatus {
        // Always true now that a client id ships with the app; kept in the
        // reply because the window should not have to know that.
        configured: !client_id(&state).is_empty(),
        connected: state.secrets.has(github::TOKEN_KEY).unwrap_or(false),
    }
}

#[tauri::command]
pub async fn apps_github_connect_start(
    state: State<'_, AppState>,
) -> Result<DeviceStart, String> {
    let client_id = client_id(&state);

    let (start, device_code) = github::start_device(&state.http, &client_id)
        .await
        .map_err(|e| e.to_string())?;

    // The device code stays here. Replacing any previous one abandons a flow
    // the person walked away from rather than leaving two in flight.
    *state.github_flow.lock().map_err(|_| "the sign-in state is unavailable")? =
        Some(PendingDevice {
            client_id,
            device_code,
            interval_s: start.interval_s,
        });

    Ok(start)
}

#[tauri::command]
pub async fn apps_github_connect_poll(state: State<'_, AppState>) -> Result<ConnectState, String> {
    let pending = {
        let guard = state
            .github_flow
            .lock()
            .map_err(|_| "the sign-in state is unavailable")?;
        guard.clone().ok_or("no sign-in is in progress")?
    };

    let outcome = github::poll_once(&state.http, &pending.client_id, &pending.device_code)
        .await
        .map_err(|e| e.to_string())?;

    match outcome {
        PollOutcome::Pending => Ok(ConnectState::Pending {
            interval_s: pending.interval_s,
        }),
        PollOutcome::SlowDown { interval_s } => {
            // GitHub's new pace is remembered, or the next poll is refused for
            // the same reason.
            if let Ok(mut guard) = state.github_flow.lock() {
                if let Some(flow) = guard.as_mut() {
                    flow.interval_s = interval_s;
                }
            }
            Ok(ConnectState::Pending { interval_s })
        }
        PollOutcome::Denied => {
            clear_flow(&state);
            Ok(ConnectState::Denied)
        }
        PollOutcome::Expired => {
            clear_flow(&state);
            Ok(ConnectState::Expired)
        }
        PollOutcome::Ready(token) => {
            // Straight to the keychain. It is never returned from here, and no
            // command exists that could read it back out.
            state
                .secrets
                .set(github::TOKEN_KEY, Secret::new(token.clone()))
                .map_err(|_| "could not store the GitHub token".to_string())?;
            clear_flow(&state);

            let login = github::fetch_summary(&state.http, &token)
                .await
                .map(|s| s.user.login)
                .unwrap_or_else(|_| "your account".to_string());

            let _ = state.audit.append(AuditEvent::new(
                AuditKind::AccountConnected,
                &format!("github as {login}"),
            ));

            Ok(ConnectState::Connected { login })
        }
    }
}

fn clear_flow(state: &State<'_, AppState>) {
    if let Ok(mut guard) = state.github_flow.lock() {
        *guard = None;
    }
}

#[tauri::command]
pub fn apps_github_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    state
        .secrets
        .delete(github::TOKEN_KEY)
        .map_err(|_| "could not remove the GitHub token".to_string())?;
    clear_flow(&state);
    let _ = state
        .audit
        .append(AuditEvent::new(AuditKind::AccountDisconnected, "github"));
    Ok(())
}

#[tauri::command]
pub async fn apps_github_summary(state: State<'_, AppState>) -> Result<Summary, String> {
    let token = state
        .secrets
        .get(github::TOKEN_KEY)
        .map_err(|_| "not connected to GitHub".to_string())?;

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::SecretRead,
        "github token read for an account refresh",
    ));

    github::fetch_summary(&state.http, token.expose())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_client_id_shaped_like_githubs() {
        assert_eq!(check_client_id("Iv23liAbCd0123").unwrap(), "Iv23liAbCd0123");
        assert_eq!(check_client_id("  Iv23li.Ab-Cd_01  ").unwrap(), "Iv23li.Ab-Cd_01");
    }

    #[test]
    fn treats_an_empty_value_as_clearing_it() {
        assert_eq!(check_client_id("   ").unwrap(), "");
    }

    // A pasted document should be a refusal, not a settings file with an
    // essay in it.
    #[test]
    fn refuses_something_far_too_long_to_be_an_id() {
        assert!(check_client_id(&"a".repeat(129)).is_err());
    }

    // Whitespace and punctuation are how a paste goes wrong; a client id that
    // silently carried them would fail every request naming the wrong problem.
    #[test]
    fn refuses_characters_a_client_id_does_not_contain() {
        assert!(check_client_id("Iv23li ABC").is_err());
        assert!(check_client_id("Iv23li/ABC").is_err());
        assert!(check_client_id("Iv23li\nABC").is_err());
    }

    // The window must be able to tell the states apart without parsing prose.
    #[test]
    fn connect_states_serialise_under_distinct_tags() {
        let pending = serde_json::to_string(&ConnectState::Pending { interval_s: 5 }).unwrap();
        assert!(pending.contains(r#""state":"pending""#), "got {pending}");
        assert!(pending.contains("5"));

        let connected =
            serde_json::to_string(&ConnectState::Connected { login: "octocat".into() }).unwrap();
        assert!(connected.contains(r#""state":"connected""#), "got {connected}");

        assert!(serde_json::to_string(&ConnectState::Denied)
            .unwrap()
            .contains(r#""state":"denied""#));
        assert!(serde_json::to_string(&ConnectState::Expired)
            .unwrap()
            .contains(r#""state":"expired""#));
    }

    // Status says whether a token exists, never what it is.
    #[test]
    fn status_carries_no_token_material() {
        let json = serde_json::to_string(&GitHubStatus {
            configured: true,
            connected: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"configured":true,"connected":true}"#);
    }
}
