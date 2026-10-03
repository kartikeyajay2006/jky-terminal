#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod audit_detail;
mod listing;
mod turn;
mod state;
mod supervisor;

use commands::{
    advice, ai, apps, browser, capture, complete, files, games, github, gmail, history, keys, memory, open,
    live, pty, remote, scrollback, settings, store, system, tools, vault, workspace, worktree,
};
use state::AppState;
use tauri::Manager;

fn main() {
    // Before anything else, and deliberately before Tauri exists at all.
    //
    // Asked to supervise, this process is not a window: it opens a pty,
    // listens on a socket and holds the shell until it exits. Starting a
    // webview first and then not using it would cost a browser's worth of
    // memory for every detached session on the machine.
    let args: Vec<String> = std::env::args().collect();

    // `jky audit`, or this binary run by hand: check the audit log's chain
    // and print the verdict. Never a window, and never an IPC command — the
    // log is for the machine's owner, not for the renderer.
    if args.iter().any(|a| a == "--verify-audit") {
        std::process::exit(verify_audit(&args));
    }

    // `jky sessions`: which shells are being held in the background, by which
    // process and which version. For diagnosing, so never a window either.
    if args.iter().any(|a| a == "--sessions") {
        std::process::exit(list_sessions(&args));
    }

    if let Some(session) = supervisor::requested(&args) {
        // The directory is given, never worked out here. The window knows it
        // already and a second derivation is the same fact twice — which is
        // how they came to disagree on macOS.
        let Some(config_dir) = supervisor::argument(&args, supervisor::CONFIG_FLAG) else {
            eprintln!("{} needs {}", supervisor::FLAG, supervisor::CONFIG_FLAG);
            std::process::exit(2);
        };
        let cwd = supervisor::argument(&args, "--cwd");
        // Failing here is a supervisor that never started, which the window
        // finds out about by not finding a session to attach to.
        let _ = supervisor::run(std::path::Path::new(&config_dir), &session, cwd);
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            // Resolved by Tauri per platform: ~/.config/dev.jky.terminal on Linux,
            // ~/Library/Application Support/dev.jky.terminal on macOS,
            // %APPDATA%\dev.jky.terminal on Windows.
            let config_dir = app.path().app_config_dir()?;
            app.manage(AppState::new(&config_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::vault_set_secret,
            vault::vault_has_secret,
            vault::vault_delete_secret,
            vault::vault_list_providers,
            complete::complete_suggest,
            workspace::workspace_list,
            workspace::workspace_save,
            workspace::workspace_forget,
            workspace::workspace_activate,
            workspace::workspace_leave,
            worktree::worktree_list,
            worktree::worktree_create,
            worktree::worktree_remove,
            files::files_folders,
            files::files_open_folder,
            files::files_close_folder,
            files::files_list,
            files::files_read,
            files::files_write,
            files::files_preview,
            files::files_create,
            files::files_rename,
            files::files_delete,
            history::history_record,
            history::history_search,
            history::history_forget,
            history::history_clear,
            memory::memory_search,
            memory::memory_pin,
            memory::memory_note,
            memory::memory_forget,
            live::live_sources,
            live::live_run,
            keys::keys_list,
            keys::keys_bind,
            keys::keys_reset,
            keys::keys_reset_all,
            settings::settings_set_selected_model,
            settings::settings_set_active_provider,
            settings::settings_set_terminal_start_dir,
            settings::settings_privacy,
            settings::settings_set_privacy,
            system::system_status,
            tools::tools_diff,
            tools::tools_end_process,
            tools::tools_environment,
            tools::tools_machine,
            tools::tools_ports,
            tools::tools_processes,
            tools::tools_request,
            tools::tools_resolve,
            tools::tools_format_yaml,
            tools::tools_hash,
            tools::tools_yaml_to_json,
            pty::pty_spawn,
            pty::pty_shell,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_release,
            pty::pty_end,
            pty::pty_prune,
            pty::commands_list,
            remote::remote_list,
            remote::remote_save,
            remote::remote_forget,
            remote::remote_spawn,
            remote::remote_config_hosts,
            remote::remote_host_key,
            capture::capture_save,
            capture::capture_copy,
            ai::ai_send,
            ai::ai_cancel,
            advice::ai_ask_once,
            ai::ai_approve_tool,
            ai::ai_reject_tool,
            store::store_list_notes,
            store::store_save_note,
            store::store_delete_note,
            store::store_list_todos,
            store::store_save_todo,
            store::store_delete_todo,
            store::store_list_events,
            store::store_save_event,
            store::store_delete_event,
            store::store_list_reminders,
            store::store_save_reminder,
            store::store_delete_reminder,
            games::games_publish_scores,
            browser::browser_open,
            browser::browser_place,
            browser::browser_close,
            browser::browser_history,
            apps::apps_locate,
            apps::apps_news,
            apps::apps_news_sources,
            apps::apps_weather,
            apps::apps_place_search,
            apps::apps_route,
            github::apps_github_set_client_id,
            github::apps_github_status,
            github::apps_github_connect_start,
            github::apps_github_connect_poll,
            github::apps_github_disconnect,
            github::apps_github_summary,
            github::apps_github_contents,
            github::apps_github_file,
            github::apps_github_commits,
            github::apps_github_branches,
            github::apps_github_notifications,
            gmail::apps_gmail_configure,
            gmail::apps_gmail_status,
            gmail::apps_gmail_connect,
            gmail::apps_gmail_disconnect,
            gmail::apps_gmail_inbox,
            gmail::apps_gmail_message,
            open::open_external,
            scrollback::scrollback_load,
            scrollback::scrollback_save,
            scrollback::scrollback_forget,
            scrollback::scrollback_prune,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JKY Terminal");
}

/// The audit check, for a terminal. Exit code 0 intact, 1 altered, 2 unreadable.
/// The config folder named on the command line, or the usual one.
fn config_dir_from(args: &[String]) -> Option<std::path::PathBuf> {
    let found = supervisor::argument(args, supervisor::CONFIG_FLAG)
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::config_dir().map(|d| d.join("dev.jky.terminal")));
    if found.is_none() {
        eprintln!("could not find the JKY Terminal config folder; pass {} <dir>", supervisor::CONFIG_FLAG);
    }
    found
}

fn list_sessions(args: &[String]) -> i32 {
    #[cfg(windows)]
    attach_parent_console();
    let Some(config_dir) = config_dir_from(args) else { return 2 };
    let dir = supervisor::jky_detach_dir(&config_dir);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    print!("{}", jky_detach::report(&jky_detach::records(&dir), now));
    0
}

fn verify_audit(args: &[String]) -> i32 {
    #[cfg(windows)]
    attach_parent_console();
    let Some(config_dir) = config_dir_from(args) else { return 2 };
    // Read-only: checking a log must never create the key it is checked with.
    let store = std::sync::Arc::new(jky_secrets::KeyringStore::new(state::KEYCHAIN_SERVICE));
    let anchor = std::sync::Arc::new(jky_audit::KeychainAnchor::read_only(store));
    let (text, code) = jky_audit::check(&config_dir.join("audit.jsonl"), anchor);
    println!("{text}");
    code
}

/// A release build on Windows is a GUI program with no console of its own,
/// so a report printed from it would go nowhere. Borrow the console of the
/// shell that started it.
#[cfg(windows)]
fn attach_parent_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    // SAFETY: AttachConsole takes a process id by value and touches no memory
    // of ours; failure (no parent console) leaves output where it was.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}
