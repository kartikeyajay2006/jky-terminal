#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use commands::vault;
use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            vault::vault_set_secret,
            vault::vault_has_secret,
            vault::vault_delete_secret,
            vault::vault_list_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JKY Terminal");
}
