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
        // One question, one answer, for a command that failed. Not `ai_send`:
        // no tools, no turn state, no history — so a suggestion under a
        // failed command cannot run anything, and cannot collide with a
        // conversation in the Assistant panel over the single turn slot.
        //
        // It reads a key to make the request and returns text. The prompt is
        // built and bounded in the window, refused here if it is larger than
        // a bounded one could be, and the answer is cut off once it is long
        // enough — dropping the connection is the only way to stop paying for
        // words nobody asked for.
        "ai_ask_once".to_string(),
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
        // The one command that fetches a message body, for the one message a
        // person opened. The list still asks for metadata only, so the
        // contents of every other message stay where they are. What crosses
        // is text: jky-apps turns an HTML part into text before it leaves
        // Rust, so no image in a message can be requested — a tracking pixel
        // cannot report the message was opened — and no script in one is ever
        // handed to something that would run it. The id is checked against
        // the same rule the list uses before it reaches a URL path.
        "apps_gmail_message".to_string(),
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
        // The two ends of the camera. Both take PNG bytes the window has
        // already rendered of itself, and neither takes a destination: the
        // window says what to keep, Rust decides where it goes. That is what
        // keeps `the_renderer_is_granted_no_filesystem_shell_or_network_capability`
        // true while a screenshot still reaches the disk — a command that
        // accepted a path would be an arbitrary file write wearing a camera.
        //
        // Neither returns bytes. `capture_save` returns the path it chose,
        // which the window only displays; `capture_copy` returns nothing at
        // all, because a command that could read the clipboard back would be a
        // way to exfiltrate whatever the user last copied.
        "capture_copy".to_string(),
        "capture_save".to_string(),
        "commands_list".to_string(),
        // Takes four numbers the window already has and renders the listing
        // `jky games` prints. The path, the format and the set of valid game
        // ids all live in Rust, so the widest this can do is print a wrong
        // score. It reads nothing and returns nothing.
        // What could come next on a command line. It reads directories, PATH
        // and a repository's refs, and it runs nothing — not the command
        // being completed, not `git`, not `--help`. That is the whole reason
        // it is one command rather than a general "ask the shell": a
        // completion engine that executed anything to find out what to offer
        // would execute it on every keystroke, at a prompt where the person
        // has not decided yet. It reads paths the shell reported rather than
        // paths the renderer chose, and answers with names, never contents.
        "complete_suggest".to_string(),
        // The editor, and the widest thing in this list — so it is worth
        // saying exactly how far it reaches and why that is as far as it
        // goes.
        //
        // "let the window name a path" is arbitrary read and arbitrary write
        // in one command, dressed as a feature, and it is the reason this app
        // had no filesystem commands until it had an editor. So the window
        // does not name a path. It names a *workspace-relative* one, and
        // `jky_files` resolves it against a folder the person opened in
        // Settings and refuses anything landing outside — checked after
        // canonicalising, so `../` and a symlink pointing out of the tree are
        // refused by the same rule rather than by a list of tricks somebody
        // thought of. Both have tests.
        //
        // Several folders may be open at once, so the boundary has two
        // halves and both are checked on every call. The outer one is here:
        // the `root` named must be a folder the person actually opened,
        // matched against settings — without it a window could name any
        // directory on the machine and this would open it, and one open
        // project would make every other one reachable. The inner one is
        // `Workspace::resolve` above. There is a test for each.
        //
        // Nothing is reachable until `files_open_folder` is called, which is
        // a deliberate act by a person and not a default. Folders are
        // re-resolved on every call rather than held, so one that was deleted
        // or unplugged stops working instead of answering for a ghost. Reads
        // are text-only and size-capped: an editor that silently rewrote the
        // bytes it could not decode would corrupt the file on the next save.
        "files_close_folder".to_string(),
        // Making, moving and removing, which is the half of an editor that
        // was missing — you could change a file but not create one. They pass
        // through exactly the two checks reading and writing do, and add
        // three rules of their own, each with a test: creating refuses a name
        // that is already taken rather than truncating it, renaming refuses a
        // target that is already taken rather than destroying it, and
        // deleting refuses a directory with anything in it. There is no undo
        // and no wastebasket here, and the shell is right there for anyone
        // who really means it.
        //
        // Delete and the source of a rename resolve the entry without
        // following its last part, so removing a symlink takes the link and
        // never what it points at.
        "files_create".to_string(),
        "files_delete".to_string(),
        "files_folders".to_string(),
        "files_list".to_string(),
        "files_open_folder".to_string(),
        // What a file is, when it is not one the editor can edit. It reads
        // the same bytes `files_read` does through the same two checks and
        // differs only in what it does with something that is not UTF-8: an
        // image comes back as bytes to draw, anything else comes back named
        // and measured. It writes nothing, and it is not a wider reach than
        // reading text — the same file, the same fence, a different answer.
        "files_preview".to_string(),
        "files_read".to_string(),
        "files_rename".to_string(),
        "files_write".to_string(),
        "games_publish_scores".to_string(),
        // Every command that has run, and the four calls that read and change
        // it. This is the most sensitive thing in the store — a command line
        // holds whatever someone typed on it, and people type secrets on
        // command lines — so note what is absent: nothing here takes a path,
        // and nothing sends anything anywhere. The file is one this app owns
        // in its own config directory, and `history_forget` exists precisely
        // so that a line with a credential in it can be taken back out, every
        // occurrence of it, rather than only the row being looked at.
        "history_clear".to_string(),
        "history_forget".to_string(),
        "history_record".to_string(),
        "history_search".to_string(),
        // What every shortcut is bound to, and the four calls that change it.
        // The keymap is a table of action names and chords — no path, no
        // command, nothing that runs. `keys_bind` is the only one that
        // writes, and it writes to one file this app owns, under a name the
        // window cannot choose: the action must be one of a fixed list and
        // the chord must parse, so neither argument reaches the filesystem as
        // text. Refusing an unmodified key is enforced here rather than in
        // the panel, because a keymap that could bind a bare letter would
        // take that letter away from every shell.
        "keys_bind".to_string(),
        "keys_list".to_string(),
        "keys_reset".to_string(),
        "keys_reset_all".to_string(),
        // Running one of three known commands again, so a panel can stay
        // current instead of being a photograph. This starts a process, which
        // makes it the sharpest thing on this list, so it is worth saying
        // exactly what it cannot do.
        //
        // It takes an *id*, never a command line. The program and its
        // arguments are constants in `jky_live` — `df -h`, `ps aux`,
        // `docker ps` — handed to the operating system as a list with no
        // shell between, so there is nothing for a quote or a semicolon to
        // mean and no path at all from a string in the renderer to a process.
        // A command line arriving here is not a command line; it is a name
        // that does not match, and there is a test that says so.
        //
        // Three, not thirty, and each was chosen for the same property: no
        // argument and no working directory. That is what makes one safe to
        // repeat unattended — a command whose meaning depends on where you
        // are would quietly start answering about somewhere else the moment
        // you changed directory. None of them writes anything.
        "live_run".to_string(),
        "live_sources".to_string(),
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
        // Terminals on other machines. `remote_spawn` is the command in this
        // whole surface that most deserves a second look, because it starts a
        // process — so note what it does not take: it takes a host *id*, and
        // builds the argument list itself from what was saved under that id.
        // There is no path here from a string in the window to a command
        // line. The program is the literal `ssh`, found on PATH the way the
        // shell finds it, never a configurable path.
        //
        // The argument list is the sharp edge and it is checked in
        // `jky_remote::argv`, with its own tests: ssh takes its options as
        // arguments, so an unchecked address is not a string but an option,
        // and `-oProxyCommand=…` is a documented way to turn "connect to this
        // host" into "run this on my laptop". Refused on save as well as on
        // connect, so the two can never disagree.
        //
        // No credential passes through any of these. This app stores no SSH
        // password and no key: connecting runs the ssh already on the
        // machine, which uses the agent and config that already work.
        "remote_forget".to_string(),
        "remote_list".to_string(),
        "remote_save".to_string(),
        "remote_spawn".to_string(),
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
        // The developer tools that need a dependency: hashing, diffing and
        // YAML. Every one is a function of its arguments — no network, no
        // filesystem, no credential, nothing kept between calls — so the only
        // thing the boundary adds is a bound on how much text the renderer
        // may hand over. That bound is not politeness: hashing a hundred
        // megabytes would block a worker thread for as long as it took.
        "tools_diff".to_string(),
        // The one developer-tool command that changes anything, and the only
        // one anywhere in this section that can. It refuses pid 0 and pid 1
        // outright — 0 means "every process in my group" on Unix and 1 is
        // init, so either takes the session or the machine with it — and it
        // writes to the audit log, because ending a process is something
        // someone should be able to find afterwards. The confirmation is in
        // the window, since it is a question for a person and a backend has
        // nobody to ask.
        "tools_end_process".to_string(),
        // This process's environment, which is what a new terminal inherits.
        // Not a running shell's: nothing outside a process can change that.
        // Values whose names suggest a secret arrive as they are and are
        // hidden by the panel, because the alternative is a tool that will
        // not show you your own environment.
        "tools_environment".to_string(),
        "tools_format_yaml".to_string(),
        "tools_hash".to_string(),
        // Processor, memory, disks, uptime. Facts about the computer, taking
        // no argument and reading nothing belonging to anyone.
        "tools_machine".to_string(),
        // Every process this user can see, sorted and cut in Rust — cutting
        // before sorting would return whatever booted earliest, and sending
        // thousands over IPC so the window could sort them would be sending
        // thousands over IPC. The sort order is chosen from a list, so the
        // window names an order and never an expression.
        // What is listening, and what holds it. Reads the kernel's socket
        // table and joins it with the process list already being sampled —
        // no argument names a command, a file or a host. It returns a pid so
        // the panel can offer to stop it, and stopping goes through
        // `tools_end_process`, which is audited: one killer, one audit trail,
        // rather than a second way in that nobody remembers to log.
        "tools_ports".to_string(),
        "tools_processes".to_string(),
        // One HTTP request, and the tool that could most easily become
        // something else: a command that sends wherever it is told is the
        // general-purpose fetcher `connect-src 'self'` exists to prevent. So
        // the scheme is checked, the method is chosen from a fixed list,
        // header names and values are validated — a value with a line break
        // in it is how one header becomes two — and both bodies are capped.
        // The rules live in `jky_apps::http` beside the sending, so a second
        // caller cannot apply three of the four.
        "tools_request".to_string(),
        // The system resolver, asked the same question everything else on
        // this machine asks it. Addresses only: MX and TXT mean speaking DNS
        // directly and choosing a server to believe, and a tool showing some
        // record types while omitting others is worse than one that says
        // which question it asked. The hostname is validated before it
        // reaches the resolver.
        "tools_resolve".to_string(),
        "tools_yaml_to_json".to_string(),
        "vault_delete_secret".to_string(),
        "vault_has_secret".to_string(),
        "vault_list_providers".to_string(),
        "vault_set_secret".to_string(),
        // What you are working on, saved under a name: which folders, where
        // terminals start, which machine.
        //
        // A workspace is a wish and not a capability, which is the whole
        // reason it is safe to keep in a file people hand-edit. It *names*
        // folders; `workspace_activate` writes those names into the editor's
        // open list, and every read after that still goes through
        // `files_read`, which checks the root is one that was opened and
        // refuses anything resolving outside it. Naming a folder here grants
        // nothing that opening it by hand would not.
        //
        // `workspace_activate` is the only one that changes anything beyond
        // this file, and what it changes is two settings. It starts no
        // process: the terminals a workspace asks for are opened by the
        // window through `pty_spawn`, the same call it already makes.
        "workspace_activate".to_string(),
        "workspace_forget".to_string(),
        "workspace_leave".to_string(),
        "workspace_list".to_string(),
        "workspace_save".to_string(),
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

/*
 * A worker may be loaded from this app and from nowhere else.
 *
 * The regex tester runs in one, which is the only way to stop a pattern that
 * will not finish. `worker-src` is what permits that — and it has to be as
 * narrow as `script-src`, because a worker is code and a worker from
 * somewhere else is somebody else's code running with this app's origin.
 */
#[test]
fn a_worker_may_only_come_from_this_app() {
    let conf: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(crate_root().join("tauri.conf.json")).unwrap())
            .expect("tauri.conf.json is valid JSON");
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("SECURITY: no CSP is configured");

    let directive = csp
        .split(';')
        .map(str::trim)
        .find(|d| d.starts_with("worker-src"))
        .expect("SECURITY: CSP defines no worker-src, so a worker falls back to script-src");

    const ALLOWED: &[&str] = &["worker-src", "'self'", "blob:"];
    for token in directive.split_whitespace() {
        assert!(
            ALLOWED.contains(&token),
            "SECURITY: CSP worker-src allows '{token}'. A worker is code, and one from \
             anywhere but this app is somebody else's code running as this app."
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

/// Every capability the renderer is granted, named.
///
/// The prefix rule above catches the three obvious ways to hand the window
/// the machine. This catches the fourth: quietly adding a fourth entry that
/// is none of those and still widens what a compromised frontend can do. The
/// list was one line for the app's whole life, and the moment it stopped
/// being one line is the moment it needed pinning.
#[test]
fn the_capabilities_granted_are_exactly_these() {
    let path = crate_root().join("capabilities/default.json");
    let raw = fs::read_to_string(&path).expect("capabilities/default.json is readable");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let granted: Vec<String> = conf["permissions"]
        .as_array()
        .expect("capabilities file declares a permissions array")
        .iter()
        .map(|p| p.as_str().unwrap_or_default().to_string())
        .collect();

    let expected = vec![
        // Tauri's own baseline: events, the webview's own window metadata,
        // and the IPC plumbing every command rides on. It grants no
        // filesystem, no shell and no network.
        "core:default".to_string(),
        // Ending this app's own window, and nothing else. It exists because
        // the editor holds unsaved work: closing is intercepted so the person
        // can be asked, and "quit anyway" then has to actually quit. `close`
        // cannot do it — it raises the same close request the guard is
        // letting through, so the window would ask again for ever.
        "core:window:allow-destroy".to_string(),
    ];

    assert_eq!(
        granted, expected,
        "SECURITY: the capabilities granted to the renderer changed. Each one widens what a \
         compromised frontend can reach without going through a reviewed command, so this list \
         is pinned. If you are adding one deliberately, update this test in the same commit and \
         say why in the message."
    );
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
