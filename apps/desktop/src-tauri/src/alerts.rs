//! Email alerts: the headless pass, and the commands that turn them on.

use std::path::PathBuf;

use jky_mail::MailConfig;
use tauri::{Manager, State};

use crate::state::AppState;

/// The keychain entry holding the mail password.
///
/// A separate account name from any provider key, so the vault's own listing
/// cannot show it and deleting a provider cannot take it with it.
pub const MAIL_ACCOUNT: &str = "smtp-app-password";

/// The config directory, resolved without Tauri.
///
/// The headless pass has no app handle — there is no app — so it has to find
/// the same directory Tauri would. Kept beside the one place that matters so
/// the two cannot drift apart silently.
pub fn headless_config_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join(crate::state::KEYCHAIN_SERVICE))
}

/// One pass, run by the operating system. Returns a process exit code.
///
/// Failures are printed rather than swallowed: this runs under a scheduler
/// that captures output, and `journalctl --user -u dev.jky.terminal.alerts`
/// is the only way anyone will find out why an alert did not arrive.
pub fn run_headless() -> i32 {
    let Some(dir) = headless_config_dir() else {
        eprintln!("jky-alerts: could not find the configuration directory");
        return 1;
    };

    let config = jky_mail::load_config(&dir);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Read on first use, not up front.
    //
    // Reaching into the keychain wakes it, and on Linux can put a prompt on
    // screen. Doing that every five minutes when there is nothing to send
    // would be its own small nuisance. Nothing is due on the overwhelming
    // majority of passes.
    let mut password: Option<String> = None;
    let mut missing_password = false;

    let outcome = jky_mail::run_once(&dir, &config, now, |event, minutes| {
        if password.is_none() {
            password = read_password();
        }
        let Some(pw) = password.as_deref() else {
            missing_password = true;
            return Err("no app password is stored".into());
        };
        jky_mail::send(&config, pw, event, minutes).map_err(|e| e.to_string())
    });

    // Reported before the password, so an incomplete configuration says what
    // is actually wrong with it rather than blaming a password that would not
    // have helped.
    if let Some(why) = &outcome.skipped {
        eprintln!("jky-alerts: {why}");
        return 1;
    }
    if missing_password {
        eprintln!(
            "jky-alerts: an alert is due but no app password is stored. \
             Add one under Dashboard, Mail Alerts."
        );
        return 1;
    }
    if outcome.sent > 0 {
        println!("jky-alerts: sent {}", outcome.sent);
    }
    if outcome.failed > 0 {
        eprintln!("jky-alerts: {} could not be sent; will try again", outcome.failed);
        return 1;
    }
    0
}

/// Read the password straight from the keychain.
///
/// The headless pass has no AppState, so it goes to the same store the app
/// uses rather than through it.
fn read_password() -> Option<String> {
    use jky_secrets::{KeyringStore, SecretStore};
    let store = KeyringStore::new(crate::state::KEYCHAIN_SERVICE);
    store.get(MAIL_ACCOUNT).ok().map(|s| s.expose().to_string())
}

// --- IPC surface ------------------------------------------------------------

#[tauri::command]
pub fn mail_read_config(state: State<'_, AppState>) -> Result<MailConfig, String> {
    Ok(jky_mail::load_config(&state.config_dir))
}

/// Save the settings, and register or remove the background helper to match.
///
/// The two are done together on purpose: settings that say alerts are on
/// while nothing is registered to send them is the failure the user cannot
/// see.
#[tauri::command]
pub fn mail_save_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: MailConfig,
) -> Result<(), String> {
    if config.enabled {
        if let Some(why) = jky_mail::why_not(&config) {
            return Err(why);
        }
    }
    jky_mail::save_config(&state.config_dir, &config).map_err(|e| e.to_string())?;

    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    if config.enabled {
        jky_mail::install(&home, &exe).map_err(|e| e.to_string())
    } else {
        jky_mail::uninstall(&home).map_err(|e| e.to_string())
    }
}

/// Store the mail password. Like every other secret here, it goes in and does
/// not come back.
#[tauri::command]
pub fn mail_set_password(state: State<'_, AppState>, password: String) -> Result<(), String> {
    let trimmed = password.trim();
    if trimmed.is_empty() {
        return Err("Paste the app password from your provider.".into());
    }
    state
        .secrets
        .set(MAIL_ACCOUNT, jky_secrets::Secret::new(trimmed.to_string()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mail_has_password(state: State<'_, AppState>) -> Result<bool, String> {
    state.secrets.has(MAIL_ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mail_delete_password(state: State<'_, AppState>) -> Result<(), String> {
    state.secrets.delete(MAIL_ACCOUNT).map_err(|e| e.to_string())
}

/// Send one message now, so the settings can be proved before an event
/// depends on them.
///
/// Everything about this configuration is invisible until something arrives —
/// wrong port, wrong password, blocked outbound mail all look identical from
/// the settings screen.
#[tauri::command]
pub fn mail_send_test(state: State<'_, AppState>) -> Result<(), String> {
    let config = jky_mail::load_config(&state.config_dir);
    if let Some(why) = jky_mail::why_not(&config) {
        return Err(why);
    }

    if !state.secrets.has(MAIL_ACCOUNT).map_err(|e| e.to_string())? {
        return Err("No app password is stored yet.".into());
    }
    let password = state.secrets.get(MAIL_ACCOUNT).map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let sample = jky_store::Event {
        id: "test".into(),
        title: "JKY Terminal test alert".into(),
        starts_at: to_rfc3339(now + 1800),
        colour: jky_store::EventColour::Cyan,
        alert_minutes_before: Some(30),
    };

    jky_mail::send(&config, password.expose(), &sample, 30).map_err(|e| e.to_string())
}

/// Seconds since the epoch back to the stored timestamp shape.
fn to_rfc3339(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// The inverse of the algorithm in jky-mail, for the one place that needs it.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mail_password_has_its_own_keychain_entry() {
        // A provider key's account name must never collide with it, or
        // deleting a provider would take the mail password with it.
        for provider in jky_secrets::ProviderId::all() {
            assert_ne!(MAIL_ACCOUNT, provider.as_key());
        }
    }

    #[test]
    fn a_timestamp_round_trips_through_the_stored_shape() {
        for iso in [
            "2026-08-27T12:30:00Z",
            "1970-01-01T00:00:00Z",
            "2000-02-29T23:59:59Z",
            "2100-03-01T00:00:00Z",
        ] {
            let secs = jky_mail::epoch_seconds(iso).unwrap();
            assert_eq!(to_rfc3339(secs), iso, "round trip failed for {iso}");
        }
    }

    #[test]
    fn the_headless_config_directory_is_the_apps_own() {
        // The pass runs with no app handle, so it resolves this itself. If it
        // ever pointed somewhere else it would read an empty events file and
        // send nothing, silently.
        let dir = headless_config_dir().unwrap();
        assert!(dir.ends_with(crate::state::KEYCHAIN_SERVICE), "{}", dir.display());
    }
}
