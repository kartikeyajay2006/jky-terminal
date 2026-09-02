#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod audit_detail;
mod listing;
mod turn;
mod state;

use commands::{
    advice, ai, apps, browser, games, github, gmail, open, pty, scrollback, settings, store, system, tools,
    vault,
};
use state::AppState;
use tauri::Manager;

fn main() {
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
            settings::settings_set_selected_model,
            settings::settings_set_active_provider,
            settings::settings_set_terminal_start_dir,
            system::system_status,
            tools::tools_diff,
            tools::tools_format_yaml,
            tools::tools_hash,
            tools::tools_yaml_to_json,
            pty::pty_spawn,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::commands_list,
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
