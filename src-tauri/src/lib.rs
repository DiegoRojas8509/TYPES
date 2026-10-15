mod claude;
mod error;
mod settings;
mod templates;
mod watcher;
mod workspace;

use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let config_file = config_dir.join("settings.json");
            let settings = settings::load(&config_file, &home);
            if let Err(e) = workspace::ensure_root(&settings.workspace_root) {
                eprintln!("could not prepare workspace root: {e}");
            }
            settings::grant_asset_scope(app.handle(), &settings.workspace_root);
            app.manage(settings::AppState::new(config_file, settings));
            app.manage(watcher::WatcherSlot::default());
            app.manage(claude::ClaudeState::default());
            watcher::restart(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_workspace_root,
            settings::set_claude_path,
            claude::claude_status,
            claude::claude_send,
            claude::claude_stop,
            workspace::list_tree,
            workspace::read_text,
            workspace::write_text,
            workspace::create_space,
            workspace::create_page,
            workspace::create_board,
            workspace::create_folder,
            workspace::rename_entry,
            workspace::delete_entry,
            workspace::import_files,
            workspace::save_attachment,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<claude::ClaudeState>().kill_all();
            }
        });
}
