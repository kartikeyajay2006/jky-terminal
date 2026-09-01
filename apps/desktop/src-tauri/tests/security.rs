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

/// Every source file in the crate, not only those under `src/commands`.
///
/// This used to read that one directory. A module added anywhere else could
/// then expose commands to the renderer without appearing in the pinned list
/// at all, which is the review these tests exist to force — and it happened
/// the moment the mail commands were written in `src/alerts.rs`.
fn command_sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &PathBuf, out: &mut Vec<(PathBuf, String)>) {
        let entries = fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|x| x == "rs") {
                let body = fs::read_to_string(&path).expect("readable source file");
                out.push((path, body));
            }
        }
    }

    let mut out = Vec::new();
    walk(&crate_root().join("src"), &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
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
        "ai_approve_tool".to_string(),
        "ai_cancel".to_string(),
        "ai_reject_tool".to_string(),
        "ai_send".to_string(),
        // The Apps section's outbound fetches. They exist because the window
        // cannot make them: `connect-src 'self'` means the webview can reach
        // no host, so Rust fetches and hands back the result. None touches the
        // keychain — every service behind them is public and needs no key, so
        // there is nothing secret on this path. Each URL is built in jky-apps
        // against a fixed host from arguments bounds-checked at this boundary,
        // so the renderer chooses parameters, never a destination.
        //
        // GitHub, over the device authorization grant. Two things never cross
        // this boundary, and both are load-bearing.
        //
        // The device code — the credential that redeems the token — stays in
        // AppState for the length of the flow. `connect_start` hands the
        // window only the short code a person types and the address to type
        // it at, which are useless on their own, and `connect_poll` takes no
        // arguments because the window has nothing the exchange needs.
        //
        // The access token is written straight to the keychain by Rust and no
        // command returns it. `status` reports two booleans; `summary`
        // returns repositories and issues. That is stricter than the AI keys,
        // which the window at least has to accept from a paste.
        //
        // `set_client_id` stores a public identifier, not a secret: the device
        // flow has no client secret. It is validated here so a pasted document
        // becomes a refusal rather than a settings file with an essay in it.
        // Reading a repository: its tree, one file, its commits, its
        // branches, and the notification list. All read-only — the scopes
        // asked for contain nothing that writes.
        //
        // The repository and path arguments are the only strings the window
        // contributes to an API url, so both are validated here: "owner/name"
        // and nothing else, and a path containing `..` is refused outright
        // rather than left for the API to resolve. The window picks from a
        // list this app fetched, so that is belt and braces — but it is what
        // stands between a renderer and an arbitrary API path.
        "apps_github_branches".to_string(),
        "apps_github_commits".to_string(),
        "apps_github_connect_poll".to_string(),
        "apps_github_connect_start".to_string(),
        "apps_github_contents".to_string(),
        "apps_github_disconnect".to_string(),
        "apps_github_file".to_string(),
        "apps_github_notifications".to_string(),
        "apps_github_set_client_id".to_string(),
        "apps_github_status".to_string(),
        "apps_github_summary".to_string(),
        // Gmail, over the authorization-code flow with PKCE. Google answers
        // an OAuth request from an embedded webview with `disallowed_useragent`,
        // so the sign-in happens in the person's own browser and this app
        // listens on a loopback socket for the redirect. `connect` runs that
        // whole exchange and returns an email address; the verifier, the
        // `state`, the code, the access token and the refresh token all stay
        // in Rust, and no command returns any of them.
        //
        // `inbox` is the only reader, and it reads metadata: three named
        // headers and the snippet Gmail sends. No message body is ever
        // fetched, so none can cross this boundary. The count is clamped and
        // the search term percent-encoded in jky-apps, against a fixed host.
        //
        // `configure` stores both halves of the OAuth client: the id in
        // settings, the secret in the keychain. Google requires a
        // `client_secret` at the token endpoint even for an installed app,
        // which the spec calls a public client — it refuses the exchange
        // without one — while documenting the value as not secret for this
        // client type, since anyone can read it out of a downloaded binary.
        // PKCE is what protects the exchange; the secret is Google's
        // paperwork. It is kept in the keychain regardless, and no command
        // returns it.
        "apps_gmail_configure".to_string(),
        "apps_gmail_connect".to_string(),
        "apps_gmail_disconnect".to_string(),
        "apps_gmail_inbox".to_string(),
        "apps_gmail_status".to_string(),
        // apps_locate: roughly where this machine is, from its public
        // address. Takes nothing from the window, so there is no input to
        // validate; it is a request Rust makes on its own to a fixed host.
        // City level at best, offered as a shortcut rather than used as
        // truth, and it touches no OS location service and no permission
        // prompt.
        "apps_locate".to_string(),
        // apps_news: headlines from one of a fixed list of papers, or all of
        // them. The window names a source by id and never by URL — a command
        // that took a feed address would be an open fetcher pointed wherever
        // the renderer asked, which is a different and much larger question
        // than reading a named newspaper. An unknown id is refused rather
        // than falling back. The count is clamped rather than trusted.
        "apps_news".to_string(),
        // apps_news_sources: the names and ids of those papers, so the picker
        // is built from the same list the fetcher reads. Takes nothing,
        // returns constants.
        "apps_news_sources".to_string(),
        // apps_place_search: the geocoder, shared by Weather and Map. Takes a
        // length-bounded search term, percent-encoded before it reaches a URL.
        "apps_place_search".to_string(),
        // apps_route: how far apart two coordinates are. Both are
        // range-checked before either reaches a URL, and the URL is built
        // against a fixed routing host. Returns two numbers and reads nothing.
        "apps_route".to_string(),
        // apps_weather: a forecast for one coordinate, range-checked here —
        // NaN included, since it would otherwise reach the query string as
        // the literal text "NaN".
        "apps_weather".to_string(),
        // The Browser app's webview. It renders pages from the open internet,
        // so what matters is what it *cannot* do: the webview is labelled
        // `browser`, no capability names that label, and a test below pins it.
        // A page it loads can call no Tauri command at all.
        //
        // Every address goes through `jky_apps::browser::normalise`, which
        // permits http and https and refuses everything else — `file://` above
        // all, since that would make the address bar a reader for the disk.
        // The rectangle is bounds-checked so the pane cannot be sized to
        // nothing or pushed off the window where it could not be closed.
        // `browser_history` takes a number this app chooses, never a string
        // from the window, so there is no script to inject.
        "browser_close".to_string(),
        "browser_history".to_string(),
        "browser_open".to_string(),
        "browser_place".to_string(),
        "commands_list".to_string(),
        // Takes four numbers the window already has and renders the listing
        // `jky games` prints. The path, the format and the set of valid game
        // ids all live in Rust, so the widest this can do is print a wrong
        // score. It reads nothing and returns nothing.
        "games_publish_scores".to_string(),
        // Hands one validated http(s) URL to the OS opener. This is the only
        // place a string from the window becomes a process argument, so the
        // rule it is checked against is itself unit-tested: scheme allow-list,
        // no whitespace, no quotes, length bound. It opens outside the app, so
        // the CSP that forbids the webview reaching any host is untouched.
        "open_external".to_string(),
        "pty_attach".to_string(),
        "pty_kill".to_string(),
        "pty_resize".to_string(),
        "pty_spawn".to_string(),
        "pty_write".to_string(),
        // What a terminal had on screen, kept across a restart. The renderer
        // chooses a key, never a path: the key shape is narrow enough to be a
        // single path component and is validated in jky-store, the directory
        // is decided in Rust, and the store applies the size cap. The widest
        // reach is saving a quarter-megabyte of the window's own output under
        // a name like `tab-3`.
        "scrollback_forget".to_string(),
        "scrollback_load".to_string(),
        "scrollback_prune".to_string(),
        "scrollback_save".to_string(),
        "settings_set_active_provider".to_string(),
        "settings_set_selected_model".to_string(),
        "settings_set_terminal_start_dir".to_string(),
        // The dashboard's own content. These read and write the user's notes,
        // todos, events and reminders — never a secret, and never a path the
        // renderer chooses: the store owns its directory.
        "store_delete_event".to_string(),
        "store_delete_note".to_string(),
        "store_delete_reminder".to_string(),
        "store_delete_todo".to_string(),
        "store_list_events".to_string(),
        "store_list_notes".to_string(),
        "store_list_reminders".to_string(),
        "store_list_todos".to_string(),
        "store_save_event".to_string(),
        "store_save_note".to_string(),
        "store_save_reminder".to_string(),
        "store_save_todo".to_string(),
        // What the machine is doing: processor, memory, disk, network. It
        // takes no arguments and reads nothing belonging to the user — no
        // paths, no processes, no command lines, no file contents. Seven
        // numbers about this computer, which is the narrowest thing that can
        // answer "is it the machine or is it me". The sampler is held in
        // AppState because two of those four are differences between
        // successive moments, not because it holds anything privileged.
        "system_status".to_string(),
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
fn no_ipc_command_is_declared_inside_a_macro() {
    // The command surface is pinned by reading these files as source, so a
    // command has to be visible as source. Twelve store commands were briefly
    // generated by a macro_rules! block and the pin saw three placeholders —
    // `$list`, `$save`, `$delete` — and none of the real names. A macro that
    // expands to #[tauri::command] can widen the renderer's reach without
    // changing the pinned list at all, which is precisely the review this
    // test exists to force.
    for (file, source) in command_sources() {
        let Some(macro_at) = source.find("macro_rules!") else { continue };

        assert!(
            !source[macro_at..].contains("#[tauri::command]"),
            "SECURITY: {} declares an IPC command inside a macro. The command-surface \
             pin reads this file as text and cannot see through macro expansion, so a \
             command declared there is exposed to the renderer without appearing in the \
             pinned list. Write it out.",
            file.display()
        );
    }
}

#[test]
fn the_audit_log_is_written_but_never_handed_to_the_renderer() {
    // It records every key read, tool call and command decision, and it is
    // for the person who owns the machine — readable with `cat`, beside the
    // settings file. No IPC command hands it to the window, so a prompt
    // injection that reaches the assistant cannot ask the frontend to read
    // back the history of everything the app has touched.
    for (file, name) in exposed_commands() {
        let lowered = name.to_lowercase();
        assert!(
            !lowered.contains("audit") && !lowered.contains("activity"),
            "SECURITY: IPC command `{name}` in {} exposes the audit log to the \
             renderer. It is written for the machine's owner to read directly, \
             not for the window.",
            file
        );
    }
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

/// `frame-src` is pinned the same way `connect-src` is, and for a related
/// reason — but the two are not the same permission and the difference is the
/// whole argument for allowing this at all.
///
/// `frame-src` lets the window *display* a document from another origin. It
/// does not let the app's own JavaScript read into that frame or make requests
/// to that host: same-origin policy still separates them, and `connect-src`
/// stays `'self'`. So the property that a compromised frontend has nowhere to
/// send anything is untouched by every host named here.
///
/// Each entry is a provider's own embed endpoint, measured to send no
/// `X-Frame-Options` and no `frame-ancestors` — which is what makes framing it
/// possible at all. Adding a host here is a deliberate widening: it is one
/// more origin whose content renders inside the app's window.
#[test]
fn the_csp_frames_only_the_embed_endpoints_the_spec_allows() {
    let config: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(crate_root().join("tauri.conf.json")).expect("readable tauri.conf.json"),
    )
    .expect("parseable tauri.conf.json");

    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("SECURITY: no CSP is configured. An absent CSP is an open door.");

    let frame_src = csp
        .split(';')
        .map(str::trim)
        .find(|d| d.starts_with("frame-src"))
        .expect(
            "SECURITY: CSP defines no frame-src. Without one it falls back to default-src, \
             and the Map app's embed would be blocked — or, worse, a later widening of \
             default-src would silently allow framing anything.",
        );

    const ALLOWED: &[&str] = &["frame-src", "https://www.openstreetmap.org"];

    for token in frame_src.split_whitespace() {
        assert!(
            ALLOWED.contains(&token),
            "SECURITY: CSP frame-src allows '{token}', which is not one of the embed \
             endpoints this app is allowed to render. Every host here is another origin \
             whose content runs inside the app window. See the Apps design spec §9."
        );
    }
}

/// The app is about to host webviews that render other people's pages, so the
/// question "which webview may call Rust" stops being rhetorical.
///
/// Tauri resolves a capability's `windows` list against *every webview in that
/// window*, and its own schema says so: "If a window label matches any of the
/// patterns in this list, the capability will be enabled on all the webviews
/// of that window, regardless of the value of `webviews`." A capability scoped
/// by window would therefore hand `core:default` to a page loaded from the
/// internet the moment one is added to the main window.
///
/// Scoping by webview label instead is what keeps that from happening.
#[test]
fn no_capability_is_scoped_by_window_where_a_child_webview_would_inherit_it() {
    for (path, capability) in capability_files() {
        let name = path.file_name().unwrap().to_string_lossy();

        assert!(
            capability.get("windows").is_none(),
            "SECURITY: {name} is scoped with `windows`. Tauri grants such a capability to \
             every webview in that window, including one loaded from the internet. Scope it \
             with `webviews` instead so only this app's own webview can call Rust."
        );

        let webviews = capability
            .get("webviews")
            .and_then(|w| w.as_array())
            .unwrap_or_else(|| {
                panic!("SECURITY: {name} names no webviews, so its reach is unbounded")
            });

        for label in webviews {
            let label = label.as_str().unwrap_or_default();
            assert!(
                !label.contains('*'),
                "SECURITY: {name} grants capabilities to the glob '{label}'. A pattern that \
                 matches a future webview grants it to pages nobody has reviewed."
            );
            assert_eq!(
                label, "main",
                "SECURITY: {name} grants capabilities to the webview '{label}'. Only this \
                 app's own webview may call Rust."
            );
        }
    }
}

/// Every capability file, parsed.
fn capability_files() -> Vec<(PathBuf, serde_json::Value)> {
    let dir = crate_root().join("capabilities");
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).expect("capabilities directory").flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "json") {
            let raw = fs::read_to_string(&path).expect("readable capability");
            out.push((path, serde_json::from_str(&raw).expect("valid capability JSON")));
        }
    }
    assert!(!out.is_empty(), "SECURITY: no capability files found to check");
    out
}

/// The Browser app renders pages nobody has reviewed, so the one thing that
/// must stay true is that they cannot call into Rust.
///
/// Its webview is labelled `browser`, and no capability may name that label —
/// by pattern or by glob. Together with the check above (no capability may be
/// scoped by window, which would grant it to every webview in that window)
/// this is what keeps a page from the internet outside the IPC boundary.
#[test]
fn the_browser_webview_is_granted_no_capability_at_all() {
    const BROWSER_LABEL: &str = "browser";

    for (path, capability) in capability_files() {
        let name = path.file_name().unwrap().to_string_lossy();
        let labels = capability
            .get("webviews")
            .and_then(|w| w.as_array())
            .cloned()
            .unwrap_or_default();

        for label in labels {
            let label = label.as_str().unwrap_or_default();
            assert_ne!(
                label, BROWSER_LABEL,
                "SECURITY: {name} grants capabilities to the browser webview. Pages loaded \
                 from the internet would be able to call Tauri commands."
            );
        }
    }
}

/// The label the browser uses must not be the one the capabilities name.
///
/// Read out of the source rather than duplicated here, so renaming the
/// constant cannot quietly move the browser inside the capability.
#[test]
fn the_browser_label_in_the_source_is_not_the_privileged_one() {
    let source = fs::read_to_string(crate_root().join("src/commands/browser.rs"))
        .expect("browser.rs is readable");
    let line = source
        .lines()
        .find(|l| l.contains("pub const BROWSER_LABEL"))
        .expect("SECURITY: browser.rs no longer declares BROWSER_LABEL");

    assert!(
        !line.contains("\"main\""),
        "SECURITY: the browser webview is labelled `main`, which is the label every \
         capability grants. A page from the internet would inherit them all."
    );
}
