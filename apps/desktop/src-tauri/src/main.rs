#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod audit_detail;
mod listing;
mod turn;
mod state;

use commands::{ai, apps, games, open, pty, scrollback, settings, store, vault};
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
            pty::pty_spawn,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::commands_list,
            ai::ai_send,
            ai::ai_cancel,
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
            apps::apps_news,
            apps::apps_news_sources,
            apps::apps_weather,
            apps::apps_place_search,
            open::open_external,
            scrollback::scrollback_load,
            scrollback::scrollback_save,
            scrollback::scrollback_forget,
            scrollback::scrollback_prune,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JKY Terminal");
}
