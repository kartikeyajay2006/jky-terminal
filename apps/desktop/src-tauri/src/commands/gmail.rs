//! Gmail, over IPC.
//!
//! Google refuses an embedded webview outright — since July 2023 an OAuth
//! request from one is answered `disallowed_useragent` — so the sign-in
//! cannot happen inside this app's window and is not attempted. The person's
//! own browser does it, and this app listens on a loopback socket for the
//! redirect that comes back. That is the authorization-code flow with PKCE:
//! no client secret exists to ship, and the code that arrives is worthless to
//! anything that did not generate the verifier.
//!
//! What never crosses to the renderer: the verifier, the `state`, the
//! authorisation code, the access token and the refresh token. The window
//! calls `connect` and is told an email address; everything in between happens
//! here. That is the same rule the GitHub token follows, and the same rule the
//! Anthropic key follows one step looser.
//!
//! Unlike GitHub, no client id ships with the build. A Google client belongs
//! to a project and a consent screen someone owns, and shipping one would put
//! every install of this app in a stranger's audit log. So the panel asks for
//! one, and says where to get it.

use jky_apps::gmail::{self, Account, Message};
use jky_apps::oauth;
use jky_audit::{AuditEvent, AuditKind};
use jky_secrets::Secret;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// What the panel needs before it can show anything.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GmailStatus {
    /// Whether a Google client id has been set. Without one there is nothing
    /// to sign in against, and the panel has to explain that rather than fail.
    pub configured: bool,
    /// Whether a token is in the keychain. Never the token.
    pub connected: bool,
}

/// One reply rather than two round trips: the panel draws the address and the
/// list together, and two calls would fill it in two jerks.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Mailbox {
    pub account: Account,
    pub messages: Vec<Message>,
}

/// A Google client id, checked before it is stored.
///
/// They end in `.apps.googleusercontent.com` and are otherwise digits, dashes
/// and letters. The bound exists so a pasted document becomes a refusal rather
/// than a settings file with an essay in it; the suffix check exists because
/// the commonest mistake is pasting the *project* id, which fails much later
/// with a message that names the wrong problem.
fn check_client_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > 200 {
        return Err("that does not look like a client id".into());
    }
    if !trimmed.ends_with(".apps.googleusercontent.com") {
        return Err("a Google client id ends in .apps.googleusercontent.com".into());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("a client id is letters, digits, dots, dashes and underscores".into());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn apps_gmail_set_client_id(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let checked = check_client_id(&id)?;
    state
        .settings
        .set_google_client_id(&checked)
        .map_err(|e| format!("could not save that: {e}"))
}

fn client_id(state: &AppState) -> Option<String> {
    state
        .settings
        .google_client_id()
        .ok()
        .flatten()
        .filter(|id| !id.trim().is_empty())
}

#[tauri::command]
pub fn apps_gmail_status(state: State<'_, AppState>) -> GmailStatus {
    GmailStatus {
        configured: client_id(&state).is_some(),
        connected: state.secrets.has(gmail::TOKEN_KEY).unwrap_or(false),
    }
}

/// Sign in, from the first click to a stored token.
///
/// One command rather than a start/poll pair, because there is nothing to poll:
/// the loopback socket blocks until the browser knocks on it. That wait is up
/// to five minutes, so it happens on a blocking thread and not on the runtime
/// that is also serving the terminal.
#[tauri::command]
pub async fn apps_gmail_connect(state: State<'_, AppState>) -> Result<String, String> {
    let client_id = client_id(&state).ok_or(
        "add a Google client id first — the panel explains where to get one",
    )?;

    // Opened before the browser is, so a failure to bind is a refusal now
    // rather than a tab that leads nowhere.
    let (listener, port) = oauth::listen().map_err(|e| e.to_string())?;
    let redirect = oauth::redirect_uri(port);
    let pkce = oauth::new_pkce();
    let expected_state = oauth::new_state();

    let url = oauth::auth_url(&client_id, &redirect, &pkce.challenge, &expected_state);
    // Through the same validation every other outbound link gets. It is a URL
    // this app built, so it will pass — which is the point of checking it
    // anyway rather than making an exception the next URL can hide behind.
    crate::commands::open::open_external(url)?;

    let waited = tokio::task::spawn_blocking(move || {
        oauth::wait_for_code(&listener, &expected_state, oauth::SIGN_IN_TIMEOUT)
    })
    .await
    .map_err(|_| "the sign-in was interrupted".to_string())?;
    let code = waited.map_err(|e| e.to_string())?;

    let tokens = oauth::exchange(&state.http, &client_id, &code, &pkce.verifier, &redirect)
        .await
        .map_err(|e| e.to_string())?;

    // The refresh token first. If storing the pair is interrupted, having the
    // standing grant without the hour-long token is recoverable and the
    // reverse is not.
    if let Some(refresh) = tokens.refresh_token.as_ref() {
        state
            .secrets
            .set(gmail::REFRESH_KEY, Secret::new(refresh.clone()))
            .map_err(|_| "could not store the Gmail refresh token".to_string())?;
    }
    state
        .secrets
        .set(gmail::TOKEN_KEY, Secret::new(tokens.access_token.clone()))
        .map_err(|_| "could not store the Gmail token".to_string())?;

    let address = gmail::fetch_account(&state.http, &tokens.access_token)
        .await
        .map(|p| p.address)
        .unwrap_or_else(|_| "your mailbox".to_string());

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::AccountConnected,
        &format!("gmail as {address}"),
    ));

    Ok(address)
}

#[tauri::command]
pub fn apps_gmail_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    // Both, and the refresh token first: it is the one that still grants
    // access tomorrow. A failure to delete the access token after this leaves
    // something that expires within the hour.
    state
        .secrets
        .delete(gmail::REFRESH_KEY)
        .map_err(|_| "could not remove the Gmail refresh token".to_string())?;
    state
        .secrets
        .delete(gmail::TOKEN_KEY)
        .map_err(|_| "could not remove the Gmail token".to_string())?;
    let _ = state
        .audit
        .append(AuditEvent::new(AuditKind::AccountDisconnected, "gmail"));
    Ok(())
}

/// The stored access token, or the reason there is none.
fn access_token(state: &AppState) -> Result<String, String> {
    state
        .secrets
        .get(gmail::TOKEN_KEY)
        .map(|t| t.expose().to_string())
        .map_err(|_| "not connected to Gmail".to_string())
}

/// Trade the refresh token for a new access token and keep it.
///
/// Google's access tokens last an hour, which is shorter than this app stays
/// open. Without this, a mailbox left on screen over lunch would come back
/// with an error that told the person to sign in again when nothing had
/// actually gone wrong.
async fn refreshed(state: &AppState) -> Result<String, String> {
    let client_id = client_id(state).ok_or("not connected to Gmail")?;
    let refresh = state
        .secrets
        .get(gmail::REFRESH_KEY)
        .map_err(|_| "sign in to Gmail again".to_string())?;

    let tokens = oauth::refresh(&state.http, &client_id, refresh.expose())
        .await
        .map_err(|_| "sign in to Gmail again".to_string())?;

    state
        .secrets
        .set(gmail::TOKEN_KEY, Secret::new(tokens.access_token.clone()))
        .map_err(|_| "could not store the Gmail token".to_string())?;

    Ok(tokens.access_token)
}

/// The inbox, or the results of a search.
///
/// The count is clamped in `jky_apps::gmail` rather than trusted, and the
/// query is percent-encoded there before it reaches a URL. The window chooses
/// parameters; it never chooses a destination.
#[tauri::command]
pub async fn apps_gmail_inbox(
    state: State<'_, AppState>,
    count: usize,
    query: Option<String>,
) -> Result<Mailbox, String> {
    let _ = state.audit.append(AuditEvent::new(
        AuditKind::SecretRead,
        "gmail token read for a mailbox refresh",
    ));

    let token = access_token(&state)?;
    let search = query.as_deref();

    match load(&state, &token, count, search).await {
        Ok(mailbox) => Ok(mailbox),
        // An expired hour-old token, which is ordinary rather than
        // exceptional. Refresh once and try again; a second failure is real.
        Err(gmail::GmailError::Upstream(401)) => {
            let token = refreshed(&state).await?;
            load(&state, &token, count, search)
                .await
                .map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn load(
    state: &AppState,
    token: &str,
    count: usize,
    query: Option<&str>,
) -> Result<Mailbox, gmail::GmailError> {
    let account = gmail::fetch_account(&state.http, token).await?;
    let messages = gmail::fetch_messages(&state.http, token, count, query).await?;
    Ok(Mailbox { account, messages })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_client_id_as_google_issues_it() {
        let id = "812345678901-a1b2c3d4e5.apps.googleusercontent.com";
        assert_eq!(check_client_id(id).unwrap(), id);
    }

    #[test]
    fn trims_what_was_pasted() {
        let id = "  812345678901-a1b2.apps.googleusercontent.com\n";
        assert_eq!(
            check_client_id(id).unwrap(),
            "812345678901-a1b2.apps.googleusercontent.com"
        );
    }

    // The commonest mistake is pasting the project id, which otherwise fails
    // much later with a message naming the wrong problem.
    #[test]
    fn refuses_something_that_is_not_a_client_id() {
        for wrong in [
            "my-project-471203",
            "812345678901",
            "https://console.cloud.google.com/apis/credentials",
            "812345678901-a1b2.apps.googleusercontent.com/../evil",
        ] {
            assert!(check_client_id(wrong).is_err(), "accepted {wrong}");
        }
    }

    #[test]
    fn an_empty_value_clears_it_rather_than_being_refused() {
        assert_eq!(check_client_id("   ").unwrap(), "");
    }

    #[test]
    fn refuses_a_pasted_document() {
        assert!(check_client_id(&"a".repeat(5000)).is_err());
    }

    // The refusal is shown in the window, so it must not echo back whatever
    // was pasted into it.
    #[test]
    fn the_refusal_never_echoes_what_was_pasted() {
        let why = check_client_id("javascript:alert(1)").unwrap_err();
        assert!(!why.contains("javascript"), "{why}");
    }
}
