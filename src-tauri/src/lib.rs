mod analytics;
mod steam;
mod tracker;

use tauri::Manager;

#[tauri::command]
fn detect_running_games(games: Vec<steam::SteamGame>) -> Vec<tracker::RunningGame> {
    tracker::detect_running_games(&games)
}

#[tauri::command]
fn get_analytics_summary(app: tauri::AppHandle) -> Result<analytics::AnalyticsSummary, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve PandaVault local data directory: {error}"))?;

    let database_path = data_dir.join("pandaforge-analytics.sqlite");

    analytics::get_analytics_summary(&database_path)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir().map_err(|error| {
                format!("Unable to resolve PandaVault local data directory: {error}")
            })?;

            std::fs::create_dir_all(&data_dir).map_err(|error| {
                format!(
                    "Unable to create PandaVault local data directory '{}': {error}",
                    data_dir.display()
                )
            })?;

            let database_path = data_dir.join("pandaforge-analytics.sqlite");

            analytics::initialize_database(&database_path)?;

            let tracker_database_path = database_path.clone();

            tauri::async_runtime::spawn_blocking(move || {
                tracker::run_background_tracker(tracker_database_path);
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            steam::scan_steam_games,
            steam::scan_approved_libraries,
            detect_running_games,
            get_analytics_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
