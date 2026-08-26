//! Executable enforcement of the security properties in
//! `docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md` §4.
//!
//! These tests read the crate's own source and configuration. If one fails,
//! do not weaken the test — the code under it has regressed.

use std::fs;
use std::path::PathBuf;

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn command_sources() -> Vec<(PathBuf, String)> {
    let dir = crate_root().join("src/commands");
    fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .map(|p| {
            let body = fs::read_to_string(&p).expect("readable source file");
            (p, body)
        })
        .collect()
}

/// Every `#[tauri::command]` exposed to the renderer, as `(file, fn_name)`.
fn exposed_commands() -> Vec<(String, String)> {
    let mut found = Vec::new();
    for (path, body) in command_sources() {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        let lines: Vec<&str> = body.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let sig = lines[i + 1..]
                .iter()
                .find(|l| l.contains("fn "))
                .expect("a #[tauri::command] attribute with no following fn");
            let name = sig
                .split("fn ")
                .nth(1)
                .and_then(|s| s.split('(').next())
                .expect("parseable fn name")
                .trim()
                .to_string();
            found.push((file.clone(), name));
        }
    }
    found
}

#[test]
fn no_ipc_command_is_shaped_like_a_secret_getter() {
    const FORBIDDEN: &[&str] = &[
        "get_secret",
        "read_secret",
        "reveal",
        "expose",
        "export_secret",
        "dump",
        "get_key",
        "api_key",
    ];

    for (file, name) in exposed_commands() {
        let lowered = name.to_lowercase();
        for needle in FORBIDDEN {
            assert!(
                !lowered.contains(needle),
                "SECURITY: IPC command `{name}` in {file} looks like a secret getter \
                 (matched '{needle}'). The frontend must never be able to read a stored \
                 secret. See spec §4.2.1."
            );
        }
    }
}

#[test]
fn the_exposed_command_surface_is_exactly_what_the_spec_allows() {
    let mut actual: Vec<String> = exposed_commands().into_iter().map(|(_, n)| n).collect();
    actual.sort();

    // Every entry here is a deliberate widening of the renderer's reach.
    // The vault and settings commands are setters or presence checks; the pty
    // commands are control operations on a session the backend owns. None
    // returns secret material, and pty_spawn returns only an opaque session id.
    let expected = vec![
        "pty_kill".to_string(),
        "pty_resize".to_string(),
        "pty_spawn".to_string(),
        "pty_write".to_string(),
        "settings_set_active_provider".to_string(),
        "settings_set_selected_model".to_string(),
        "settings_set_terminal_start_dir".to_string(),
        "vault_delete_secret".to_string(),
        "vault_has_secret".to_string(),
        "vault_list_providers".to_string(),
        "vault_set_secret".to_string(),
    ];

    assert_eq!(
        actual, expected,
        "SECURITY: the IPC surface changed. Every command exposed to the renderer \
         widens the attack surface, so this list is deliberately pinned. If you are \
         adding a command intentionally, update this test in the same commit and say \
         why in the message."
    );
}

#[test]
fn no_command_returns_a_secret_type() {
    for (path, body) in command_sources() {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        let lines: Vec<&str> = body.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let sig = lines[i + 1..]
                .iter()
                .take(6)
                .copied()
                .collect::<Vec<_>>()
                .join(" ");
            assert!(
                !sig.contains("Secret<"),
                "SECURITY: a #[tauri::command] in {file} has `Secret<` in its signature. \
                 Secret material must not cross the IPC boundary. Signature: {sig}"
            );
        }
    }
}

#[test]
fn csp_connect_src_permits_no_external_origin() {
    let conf_path = crate_root().join("tauri.conf.json");
    let raw = fs::read_to_string(&conf_path).expect("tauri.conf.json is readable");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("SECURITY: no CSP is configured. An absent CSP is an open door.");

    let connect_src = csp
        .split(';')
        .map(str::trim)
        .find(|d| d.starts_with("connect-src"))
        .expect("SECURITY: CSP defines no connect-src directive");

    // Required by Tauri v2's IPC transport; neither reaches the public network.
    const ALLOWED: &[&str] = &["connect-src", "'self'", "ipc:", "http://ipc.localhost"];

    for token in connect_src.split_whitespace() {
        assert!(
            ALLOWED.contains(&token),
            "SECURITY: CSP connect-src allows '{token}'. The webview must not be able to \
             reach any external origin — that is what stops a compromised frontend from \
             exfiltrating the user's API key. See spec §4.2.2."
        );
    }
}

/// Returns the forbidden prefix a capability matches, if any.
///
/// Split out from the manifest check so the rule itself is directly testable.
/// That matters here: Tauri's build script refuses to compile a capability
/// naming a plugin that is not a dependency, so you cannot demonstrate this
/// guard by simply pasting `fs:allow-read-file` into the manifest — the build
/// fails first, and the test never runs. This function lets the rule be proven
/// on its own, and the guard below then applies it to the real manifest.
fn forbidden_capability(name: &str) -> Option<&'static str> {
    const FORBIDDEN_PREFIXES: &[&str] = &["fs:", "shell:", "http:"];
    FORBIDDEN_PREFIXES
        .iter()
        .copied()
        .find(|prefix| name.starts_with(prefix))
}

#[test]
fn the_capability_rule_rejects_filesystem_shell_and_network_prefixes() {
    assert_eq!(forbidden_capability("fs:allow-read-file"), Some("fs:"));
    assert_eq!(forbidden_capability("shell:allow-execute"), Some("shell:"));
    assert_eq!(forbidden_capability("http:default"), Some("http:"));
    assert_eq!(forbidden_capability("core:default"), None);
    assert_eq!(forbidden_capability("core:event:allow-listen"), None);
}

#[test]
fn the_renderer_is_granted_no_filesystem_shell_or_network_capability() {
    let path = crate_root().join("capabilities/default.json");
    let raw = fs::read_to_string(&path).expect("capabilities/default.json is readable");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let permissions = conf["permissions"]
        .as_array()
        .expect("capabilities file declares a permissions array");

    for p in permissions {
        let name = p.as_str().unwrap_or_default();
        if let Some(prefix) = forbidden_capability(name) {
            panic!(
                "SECURITY: capability '{name}' grants the renderer direct {prefix} access. \
                 Every privileged action must go through an explicit command. See spec §4.2.4."
            );
        }
    }
}
