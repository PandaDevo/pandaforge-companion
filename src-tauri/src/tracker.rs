use crate::{
    analytics,
    steam::{self, SteamGame},
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{ProcessesToUpdate, System};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
const LIBRARY_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const STALE_SESSION_THRESHOLD_SECONDS: i64 = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningGame {
    pub app_id: String,
    pub name: String,
    pub install_path: String,
    pub executable_path: String,
}

fn normalize_path(path: &Path) -> PathBuf {
    let value = path
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase();

    PathBuf::from(value)
}

fn executable_belongs_to_game(executable: &Path, install_path: &Path) -> bool {
    let executable = normalize_path(executable);
    let install_path = normalize_path(install_path);

    executable.starts_with(&install_path)
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub fn detect_running_games(games: &[SteamGame]) -> Vec<RunningGame> {
    let mut system = System::new();

    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut running = Vec::new();

    for game in games {
        let install_path = Path::new(&game.install_path);

        if !install_path.exists() {
            continue;
        }

        let matched_process = system
            .processes()
            .values()
            .filter_map(|process| process.exe())
            .find(|exe| executable_belongs_to_game(exe, install_path));

        let Some(executable) = matched_process else {
            continue;
        };

        running.push(RunningGame {
            app_id: game.app_id.clone(),
            name: game.name.clone(),
            install_path: game.install_path.clone(),
            executable_path: executable.to_string_lossy().to_string(),
        });
    }

    running.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    running
}

pub fn reconcile_running_games(
    database_path: &Path,
    running_games: &[RunningGame],
    now: i64,
) -> Result<(), String> {
    let active_sessions = analytics::load_active_sessions(database_path)?;

    let running_by_id: HashMap<&str, &RunningGame> = running_games
        .iter()
        .map(|game| (game.app_id.as_str(), game))
        .collect();

    let active_app_ids: HashSet<String> = active_sessions
        .iter()
        .map(|session| session.app_id.clone())
        .collect();

    for active in &active_sessions {
        match running_by_id.get(active.app_id.as_str()) {
            Some(running_game) => {
                let heartbeat_gap = now.saturating_sub(active.last_seen_at).max(0);

                if heartbeat_gap > STALE_SESSION_THRESHOLD_SECONDS {
                    analytics::complete_active_session(
                        database_path,
                        &active.app_id,
                        active.last_seen_at,
                    )?;

                    analytics::start_active_session(
                        database_path,
                        &running_game.app_id,
                        &running_game.name,
                        now,
                    )?;
                } else {
                    analytics::touch_active_session(database_path, &active.app_id, now)?;
                }
            }
            None => {
                analytics::complete_active_session(
                    database_path,
                    &active.app_id,
                    active.last_seen_at,
                )?;
            }
        }
    }

    for running_game in running_games {
        if !active_app_ids.contains(&running_game.app_id) {
            analytics::start_active_session(
                database_path,
                &running_game.app_id,
                &running_game.name,
                now,
            )?;
        }
    }

    Ok(())
}

pub fn run_background_tracker(database_path: PathBuf) {
    let mut cached_games: Vec<SteamGame> = Vec::new();
    let mut last_library_refresh: Option<Instant> = None;
    let mut has_successful_scan = false;

    loop {
        let should_refresh_library = last_library_refresh
            .map(|last_refresh| last_refresh.elapsed() >= LIBRARY_REFRESH_INTERVAL)
            .unwrap_or(true);

        if should_refresh_library {
            match steam::scan_steam_games() {
                Ok(scan) => {
                    cached_games = scan.games;
                    last_library_refresh = Some(Instant::now());
                    has_successful_scan = true;
                }
                Err(error) => {
                    eprintln!("PandaVault background Steam scan failed: {error}");
                }
            }
        }

        if has_successful_scan {
            let running_games = detect_running_games(&cached_games);
            let now = unix_timestamp();

            if let Err(error) = reconcile_running_games(&database_path, &running_games, now) {
                eprintln!("PandaVault session tracker failed: {error}");
            }
        }

        thread::sleep(HEARTBEAT_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_db_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();

        std::env::temp_dir().join(format!("pandavault-tracker-{name}-{unique}.sqlite"))
    }

    fn running_game(app_id: &str, name: &str) -> RunningGame {
        RunningGame {
            app_id: app_id.to_string(),
            name: name.to_string(),
            install_path: format!(r"C:\Games\{name}"),
            executable_path: format!(r"C:\Games\{name}\game.exe"),
        }
    }

    #[test]
    fn executable_inside_game_folder_matches() {
        let install =
            Path::new(r"C:\Program Files (x86)\Steam\steamapps\common\Total War WARHAMMER III");

        let executable = Path::new(
            r"C:\Program Files (x86)\Steam\steamapps\common\Total War WARHAMMER III\Warhammer3.exe",
        );

        assert!(executable_belongs_to_game(executable, install));
    }

    #[test]
    fn executable_outside_game_folder_does_not_match() {
        let install =
            Path::new(r"C:\Program Files (x86)\Steam\steamapps\common\Total War WARHAMMER III");

        let executable = Path::new(r"C:\Program Files (x86)\Steam\steam.exe");

        assert!(!executable_belongs_to_game(executable, install));
    }

    #[test]
    fn matching_is_case_insensitive_on_windows_style_paths() {
        let install = Path::new(r"C:\Games\Melvor Idle");

        let executable = Path::new(r"c:\games\melvor idle\MelvorIdle.exe");

        assert!(executable_belongs_to_game(executable, install));
    }

    #[test]
    fn reconciliation_starts_heartbeats_and_completes_one_session() {
        let path = temp_db_path("lifecycle");

        analytics::initialize_database(&path).expect("analytics database should initialize");

        let game = running_game("4541930", "The Undercut: Racing Manager");

        reconcile_running_games(&path, &[game.clone()], 1_000).expect("session should start");

        reconcile_running_games(&path, &[game], 1_010).expect("session should heartbeat");

        let active = analytics::load_active_sessions(&path).expect("active session should load");

        assert_eq!(active.len(), 1);
        assert_eq!(active[0].started_at, 1_000);
        assert_eq!(active[0].last_seen_at, 1_010);

        reconcile_running_games(&path, &[], 1_020).expect("session should complete");

        assert!(analytics::load_active_sessions(&path)
            .expect("active sessions should load")
            .is_empty());

        let connection = Connection::open(&path).expect("database should reopen");

        let duration: i64 = connection
            .query_row(
                "
                SELECT duration_seconds
                FROM game_sessions
                WHERE app_id = '4541930'
                ",
                [],
                |row| row.get(0),
            )
            .expect("completed session should exist");

        assert_eq!(duration, 10);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn stale_running_session_is_split_conservatively() {
        let path = temp_db_path("stale");

        analytics::initialize_database(&path).expect("analytics database should initialize");

        let game = running_game("1267910", "Melvor Idle");

        reconcile_running_games(&path, &[game.clone()], 1_000).expect("session should start");

        reconcile_running_games(&path, &[game], 1_121).expect("stale session should recover");

        let active = analytics::load_active_sessions(&path).expect("active session should load");

        assert_eq!(active.len(), 1);
        assert_eq!(active[0].started_at, 1_121);

        let connection = Connection::open(&path).expect("database should reopen");

        let completed_count: i64 = connection
            .query_row(
                "
                SELECT COUNT(*)
                FROM game_sessions
                WHERE app_id = '1267910'
                ",
                [],
                |row| row.get(0),
            )
            .expect("completed session count should load");

        assert_eq!(completed_count, 1);

        let _ = fs::remove_file(path);
    }
}
