//! Summoning JKY from anywhere.
//!
//! Three paths lead to the same window:
//!
//! - **The summon shortcut**, registered while JKY runs, brings the window
//!   forward from any app. Chosen once — by the installer, through
//!   `--set-shortcut`, or in Settings → Keyboard — and stored in settings.
//! - **A second launch** — `jky` in a terminal, a dock or Start-menu click, an
//!   OS-level shortcut the installer set up — finds the running JKY and
//!   brings its window forward instead of opening another.
//! - **The OS**, where it allows it: the installers register the same
//!   shortcut with GNOME and on the Windows Start-menu shortcut, so it opens
//!   JKY even when JKY is not running. Those launches arrive here as the
//!   second launch above.
//!
//! Where a platform will not let an app hold a global shortcut — a Wayland
//! session, or a combination another app already owns — that is said, in
//! words, rather than the shortcut silently doing nothing.

use std::path::Path;

use jky_keys::summon::{accelerator, is_off, normalize};
use jky_settings::SettingsStore;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// What Settings shows about the summon shortcut.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SummonView {
    /// The stored shortcut, canonical — `Super+J` — or none.
    pub shortcut: Option<String>,
    /// Whether this running JKY holds it right now.
    pub active: bool,
    /// Why it is not active, or what is worth knowing about it here.
    pub note: Option<String>,
}

/// Read what a person typed: a shortcut, or one of the ways of saying none.
pub fn parse_request(input: &str) -> Result<Option<String>, String> {
    if is_off(input) {
        return Ok(None);
    }
    normalize(input).map(Some).map_err(|e| e.to_string())
}

/// `--set-shortcut <shortcut|none>`: check it and store it, for the installers.
pub fn set_logic(settings: &SettingsStore, input: &str) -> Result<Option<String>, String> {
    let shortcut = parse_request(input)?;
    settings.set_summon_shortcut(shortcut.as_deref()).map_err(|e| e.to_string())?;
    Ok(shortcut)
}

/// The shortcut as the global-shortcut library takes it.
pub fn to_shortcut(canonical: &str) -> Result<Shortcut, String> {
    accelerator(canonical)
        .parse::<Shortcut>()
        .map_err(|e| format!("{canonical} cannot be registered here: {e}"))
}

// ─── the desktop's own binding ──────────────────────────────────────────────
//
// The installers register the shortcut with the desktop too, where the
// desktop allows it — a GNOME custom keybinding, the Start-menu shortcut's
// hotkey — so it opens JKY even when JKY is not running. Changing the
// shortcut in Settings keeps that binding in step. Only a binding the
// installer made is ever touched: nothing is added to a desktop that did not
// have one.

/// Where the installer put JKY's GNOME keybinding.
pub const GNOME_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/jky-terminal/";
const GNOME_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";

/// `Ctrl+Alt+J` as GNOME spells it: `<Control><Alt>j`.
pub fn gnome_accel(canonical: &str) -> String {
    let (mods, key) = canonical.rsplit_once('+').unwrap_or(("", canonical));
    let key = match key {
        "Space" => "space".to_string(),
        k if k.len() == 1 => k.to_ascii_lowercase(),
        k => k.to_string(),
    };
    let mut out = String::new();
    for m in mods.split('+').filter(|m| !m.is_empty()) {
        out.push_str(match m {
            "Ctrl" => "<Control>",
            "Alt" => "<Alt>",
            "Shift" => "<Shift>",
            _ => "<Super>",
        });
    }
    out + &key
}

/// Whether GNOME's list of custom keybindings includes JKY's.
pub fn gnome_lists(list: &str) -> bool {
    list.contains(&format!("'{GNOME_PATH}'"))
}

/// GNOME's list without JKY's keybinding in it.
pub fn gnome_list_without(list: &str) -> String {
    let ours = format!("'{GNOME_PATH}'");
    let kept: Vec<&str> = list
        .trim()
        .trim_start_matches("@as ")
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty() && *item != ours)
        .collect();
    if kept.is_empty() {
        "@as []".into()
    } else {
        format!("[{}]", kept.join(", "))
    }
}

/// The Start-menu shortcut's own hotkey for a shortcut, where Windows allows
/// one: two or more of Ctrl, Alt and Shift, with a letter, digit or F-key.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn link_hotkey(canonical: &str) -> Option<String> {
    let parts: Vec<&str> = canonical.split('+').collect();
    let (key, mods) = parts.split_last()?;
    if mods.len() < 2 || mods.contains(&"Super") || *key == "Space" {
        return None;
    }
    let mut out: Vec<String> = mods.iter().map(|m| m.to_ascii_uppercase()).collect();
    out.push(key.to_ascii_uppercase());
    Some(out.join("+"))
}

fn gnome_get_list() -> Option<String> {
    let out = std::process::Command::new("gsettings").args(["get", GNOME_SCHEMA, "custom-keybindings"]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Whether the installer's GNOME keybinding is there, so GNOME holds the key.
fn gnome_binding_present() -> bool {
    cfg!(target_os = "linux") && gnome_get_list().is_some_and(|l| gnome_lists(&l))
}

#[cfg(windows)]
fn start_menu_link() -> Option<std::path::PathBuf> {
    let link = std::path::PathBuf::from(std::env::var_os("APPDATA")?)
        .join(r"Microsoft\Windows\Start Menu\Programs\JKY Terminal.lnk");
    link.exists().then_some(link)
}

/// Bring the desktop's own binding, if the installer made one, into step.
pub fn sync_desktop(canonical: Option<&str>) {
    if cfg!(target_os = "linux") {
        let Some(list) = gnome_get_list() else { return };
        if !gnome_lists(&list) {
            return;
        }
        let run = |args: &[&str]| {
            let _ = std::process::Command::new("gsettings").args(args).status();
        };
        match canonical {
            Some(c) => run(&["set", &format!("{GNOME_SCHEMA}.custom-keybinding:{GNOME_PATH}"), "binding", &gnome_accel(c)]),
            None => run(&["set", GNOME_SCHEMA, "custom-keybindings", &gnome_list_without(&list)]),
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let Some(link) = start_menu_link() else { return };
        let hotkey = canonical.and_then(link_hotkey).unwrap_or_default();
        let quoted = link.display().to_string().replace('\'', "''");
        let script = format!(
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{quoted}'); $s.Hotkey = '{hotkey}'; $s.Save()"
        );
        // CREATE_NO_WINDOW: no console flashes up for a settings change.
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .status();
    }
}

/// What is worth saying about global shortcuts on this desktop, if anything.
fn platform_note() -> Option<String> {
    if gnome_binding_present() {
        return Some("GNOME holds it for JKY too, so it opens JKY even when JKY is closed.".into());
    }
    if cfg!(target_os = "linux")
        && std::env::var("XDG_SESSION_TYPE").map(|s| s.eq_ignore_ascii_case("wayland")).unwrap_or(false)
    {
        return Some(
            "This is a Wayland session, where the desktop — not an app — owns global shortcuts. \
             On GNOME the installer registers it with the desktop; elsewhere, add a shortcut in your \
             keyboard settings that runs `jky`."
                .into(),
        );
    }
    None
}

/// Bring the main window forward: shown, restored, focused.
pub fn summon(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hold `shortcut` for this running JKY, letting go of `previous` first.
pub fn register(app: &AppHandle, previous: Option<&str>, shortcut: Option<&str>) -> SummonView {
    let manager = app.global_shortcut();
    if let Some(old) = previous.and_then(|p| to_shortcut(p).ok()) {
        let _ = manager.unregister(old);
    }
    let Some(canonical) = shortcut else {
        return SummonView { shortcut: None, active: false, note: None };
    };
    let outcome = to_shortcut(canonical).and_then(|s| manager.register(s).map_err(|e| e.to_string()));
    #[cfg(windows)]
    {
        if outcome.is_err() && link_hotkey(canonical).is_some() && start_menu_link().is_some() {
            // Explorer holds a Start-menu hotkey itself, so JKY cannot also
            // hold it — and does not need to: it opens JKY, closed or open.
            return SummonView {
                shortcut: Some(canonical.into()),
                active: true,
                note: Some("The Start-menu shortcut holds it, so it opens JKY even when JKY is closed.".into()),
            };
        }
    }
    match outcome {
        Ok(()) => SummonView { shortcut: Some(canonical.into()), active: true, note: platform_note() },
        Err(e) => SummonView {
            shortcut: Some(canonical.into()),
            active: false,
            note: Some(platform_note().unwrap_or_else(|| {
                format!(
                    "{canonical} could not be held — another app may already use it ({e}). \
                     Choose another, or free it there."
                )
            })),
        },
    }
}

/// The plugin, with the one thing every summon press does.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                summon(app);
            }
        })
        .build()
}

/// `jky-terminal --set-shortcut <shortcut|none> [--config-dir <dir>]`.
///
/// What the installers run once a shortcut is chosen. Prints the stored form,
/// or why it was refused, and exits 0 or 2.
pub fn set_from_cli(config_dir: &Path, input: &str) -> i32 {
    let settings = SettingsStore::new(config_dir.join("settings.json"));
    match set_logic(&settings, input) {
        Ok(Some(shortcut)) => {
            println!("{shortcut}");
            0
        }
        Ok(None) => {
            println!("none");
            0
        }
        Err(e) => {
            eprintln!("jky: {e}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../../scripts/install/shortcuts.tsv");

    #[test]
    fn every_shortcut_the_installers_can_store_can_be_registered() {
        for line in CASES.lines().filter(|l| !l.starts_with('#')) {
            let (_, expected) = line.split_once('\t').unwrap();
            if expected != "ERROR" {
                assert!(to_shortcut(expected).is_ok(), "{expected} does not parse as a global shortcut");
            }
        }
    }

    #[test]
    fn gnome_spells_shortcuts_the_way_the_installer_does() {
        assert_eq!(gnome_accel("Super+J"), "<Super>j");
        assert_eq!(gnome_accel("Ctrl+Alt+Space"), "<Control><Alt>space");
        assert_eq!(gnome_accel("Shift+Super+T"), "<Shift><Super>t");
        assert_eq!(gnome_accel("Alt+F12"), "<Alt>F12");
    }

    #[test]
    fn only_some_shortcuts_can_live_on_the_start_menu() {
        assert_eq!(link_hotkey("Ctrl+Alt+J").as_deref(), Some("CTRL+ALT+J"));
        assert_eq!(link_hotkey("Ctrl+Alt+Shift+K").as_deref(), Some("CTRL+ALT+SHIFT+K"));
        assert_eq!(link_hotkey("Super+J"), None, "Windows will not put Win on a shortcut");
        assert_eq!(link_hotkey("Ctrl+Alt+Space"), None);
        assert_eq!(link_hotkey("Alt+F12"), None, "one modifier is not enough there");
    }

    #[test]
    fn our_gnome_binding_is_found_and_removed_without_touching_others() {
        let ours = GNOME_PATH;
        let list = format!("['/x/custom0/', '{ours}']");
        assert!(gnome_lists(&list));
        assert_eq!(gnome_list_without(&list), "['/x/custom0/']");
        assert_eq!(gnome_list_without(&format!("['{ours}']")), "@as []");
        assert!(!gnome_lists("['/x/custom0/']"));
    }

    #[test]
    fn the_cli_stores_a_shortcut_in_its_canonical_form() {
        let dir = tempfile::TempDir::new().unwrap();
        let settings = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(set_logic(&settings, "cmd + shift + t").unwrap().as_deref(), Some("Shift+Super+T"));
        assert_eq!(settings.summon_shortcut().unwrap().as_deref(), Some("Shift+Super+T"));
    }

    #[test]
    fn none_clears_it_and_a_bad_one_changes_nothing() {
        let dir = tempfile::TempDir::new().unwrap();
        let settings = SettingsStore::new(dir.path().join("settings.json"));
        set_logic(&settings, "Super+J").unwrap();
        assert!(set_logic(&settings, "ctrl+j").is_err());
        assert_eq!(settings.summon_shortcut().unwrap().as_deref(), Some("Super+J"), "a refusal changed it");
        assert_eq!(set_logic(&settings, "none").unwrap(), None);
        assert_eq!(settings.summon_shortcut().unwrap(), None);
    }

    #[test]
    fn the_cli_reports_the_stored_form_and_its_exit_status() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(set_from_cli(dir.path(), "super+j"), 0);
        assert_eq!(set_from_cli(dir.path(), "j"), 2);
        let settings = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(settings.summon_shortcut().unwrap().as_deref(), Some("Super+J"));
    }
}
