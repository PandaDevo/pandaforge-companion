use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSession {
    pub app_id: String,
    pub game_name: String,
    pub started_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameAnalytics {
    pub app_id: String,
    pub game_name: String,
    pub total_seconds: i64,
    pub session_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub id: i64,
    pub app_id: String,
    pub game_name: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_seconds: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub total_seconds: i64,
    pub session_count: i64,
    pub unique_games: i64,
    pub top_games: Vec<GameAnalytics>,
    pub recent_sessions: Vec<RecentSession>,
}

pub fn initialize_database(path: &Path) -> Result<(), String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS game_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                game_name TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                duration_seconds INTEGER,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE INDEX IF NOT EXISTS idx_game_sessions_app_id
                ON game_sessions(app_id);

            CREATE INDEX IF NOT EXISTS idx_game_sessions_started_at
                ON game_sessions(started_at);

            CREATE TABLE IF NOT EXISTS active_game_sessions (
                app_id TEXT PRIMARY KEY,
                game_name TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_active_game_sessions_last_seen
                ON active_game_sessions(last_seen_at);
            ",
        )
        .map_err(|error| format!("Unable to initialize analytics database: {error}"))?;

    Ok(())
}

pub fn load_active_sessions(path: &Path) -> Result<Vec<ActiveSession>, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    let mut statement = connection
        .prepare(
            "
            SELECT
                app_id,
                game_name,
                started_at,
                last_seen_at
            FROM active_game_sessions
            ORDER BY started_at ASC
            ",
        )
        .map_err(|error| format!("Unable to prepare active session query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(ActiveSession {
                app_id: row.get(0)?,
                game_name: row.get(1)?,
                started_at: row.get(2)?,
                last_seen_at: row.get(3)?,
            })
        })
        .map_err(|error| format!("Unable to query active sessions: {error}"))?;

    let mut sessions = Vec::new();

    for row in rows {
        sessions.push(row.map_err(|error| format!("Unable to read active session row: {error}"))?);
    }

    Ok(sessions)
}

pub fn start_active_session(
    path: &Path,
    app_id: &str,
    game_name: &str,
    started_at: i64,
) -> Result<(), String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    connection
        .execute(
            "
            INSERT OR IGNORE INTO active_game_sessions (
                app_id,
                game_name,
                started_at,
                last_seen_at
            )
            VALUES (?1, ?2, ?3, ?3)
            ",
            params![app_id, game_name, started_at],
        )
        .map_err(|error| format!("Unable to start active game session: {error}"))?;

    Ok(())
}

pub fn touch_active_session(path: &Path, app_id: &str, last_seen_at: i64) -> Result<(), String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    connection
        .execute(
            "
            UPDATE active_game_sessions
            SET last_seen_at = ?2
            WHERE app_id = ?1
            ",
            params![app_id, last_seen_at],
        )
        .map_err(|error| format!("Unable to update active game session: {error}"))?;

    Ok(())
}

pub fn complete_active_session(path: &Path, app_id: &str, ended_at: i64) -> Result<bool, String> {
    let mut connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to start analytics transaction: {error}"))?;

    let active = transaction
        .query_row(
            "
            SELECT
                app_id,
                game_name,
                started_at,
                last_seen_at
            FROM active_game_sessions
            WHERE app_id = ?1
            ",
            params![app_id],
            |row| {
                Ok(ActiveSession {
                    app_id: row.get(0)?,
                    game_name: row.get(1)?,
                    started_at: row.get(2)?,
                    last_seen_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Unable to load active game session: {error}"))?;

    let Some(active) = active else {
        return Ok(false);
    };

    let safe_ended_at = ended_at.max(active.started_at);
    let duration_seconds = safe_ended_at.saturating_sub(active.started_at).max(0);

    transaction
        .execute(
            "
            INSERT INTO game_sessions (
                app_id,
                game_name,
                started_at,
                ended_at,
                duration_seconds
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                active.app_id,
                active.game_name,
                active.started_at,
                safe_ended_at,
                duration_seconds
            ],
        )
        .map_err(|error| format!("Unable to save completed game session: {error}"))?;

    transaction
        .execute(
            "
            DELETE FROM active_game_sessions
            WHERE app_id = ?1
            ",
            params![app_id],
        )
        .map_err(|error| format!("Unable to remove completed active session: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("Unable to commit completed game session: {error}"))?;

    Ok(true)
}

pub fn get_analytics_summary(path: &Path) -> Result<AnalyticsSummary, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    let (session_count, total_seconds, unique_games): (i64, i64, i64) = connection
        .query_row(
            "
            SELECT
                COUNT(*),
                COALESCE(SUM(duration_seconds), 0),
                COUNT(DISTINCT app_id)
            FROM game_sessions
            WHERE ended_at IS NOT NULL
            ",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Unable to load analytics totals: {error}"))?;

    let mut top_games_statement = connection
        .prepare(
            "
            SELECT
                app_id,
                game_name,
                COALESCE(SUM(duration_seconds), 0) AS total_seconds,
                COUNT(*) AS session_count
            FROM game_sessions
            WHERE ended_at IS NOT NULL
            GROUP BY app_id, game_name
            ORDER BY total_seconds DESC, game_name ASC
            LIMIT 5
            ",
        )
        .map_err(|error| format!("Unable to prepare top games query: {error}"))?;

    let top_game_rows = top_games_statement
        .query_map([], |row| {
            Ok(GameAnalytics {
                app_id: row.get(0)?,
                game_name: row.get(1)?,
                total_seconds: row.get(2)?,
                session_count: row.get(3)?,
            })
        })
        .map_err(|error| format!("Unable to load top games: {error}"))?;

    let mut top_games = Vec::new();

    for row in top_game_rows {
        top_games.push(row.map_err(|error| format!("Unable to read top game row: {error}"))?);
    }

    let mut recent_statement = connection
        .prepare(
            "
            SELECT
                id,
                app_id,
                game_name,
                started_at,
                ended_at,
                duration_seconds
            FROM game_sessions
            WHERE ended_at IS NOT NULL
            ORDER BY id DESC
            LIMIT 10
            ",
        )
        .map_err(|error| format!("Unable to prepare recent sessions query: {error}"))?;

    let recent_rows = recent_statement
        .query_map([], |row| {
            Ok(RecentSession {
                id: row.get(0)?,
                app_id: row.get(1)?,
                game_name: row.get(2)?,
                started_at: row.get(3)?,
                ended_at: row.get(4)?,
                duration_seconds: row.get(5)?,
            })
        })
        .map_err(|error| format!("Unable to load recent sessions: {error}"))?;

    let mut recent_sessions = Vec::new();

    for row in recent_rows {
        recent_sessions
            .push(row.map_err(|error| format!("Unable to read recent session row: {error}"))?);
    }

    Ok(AnalyticsSummary {
        total_seconds,
        session_count,
        unique_games,
        top_games,
        recent_sessions,
    })
}

#[cfg(test)]
fn insert_completed_session(
    path: &Path,
    app_id: &str,
    game_name: &str,
    started_at: i64,
    ended_at: i64,
) -> Result<(), String> {
    let duration_seconds = ended_at.saturating_sub(started_at).max(0);

    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open analytics database: {error}"))?;

    connection
        .execute(
            "
            INSERT INTO game_sessions (
                app_id,
                game_name,
                started_at,
                ended_at,
                duration_seconds
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![app_id, game_name, started_at, ended_at, duration_seconds],
        )
        .map_err(|error| format!("Unable to save game session: {error}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();

        std::env::temp_dir().join(format!("pandavault-{name}-{unique}.sqlite"))
    }

    #[test]
    fn creates_session_tables() {
        let path = temp_db_path("schema");

        initialize_database(&path).expect("database should initialize");

        let connection = Connection::open(&path).expect("database should reopen");

        let completed_count: i64 = connection
            .query_row(
                "
                SELECT COUNT(*)
                FROM sqlite_master
                WHERE type = 'table'
                  AND name = 'game_sessions'
                ",
                [],
                |row| row.get(0),
            )
            .expect("completed session table query should succeed");

        let active_count: i64 = connection
            .query_row(
                "
                SELECT COUNT(*)
                FROM sqlite_master
                WHERE type = 'table'
                  AND name = 'active_game_sessions'
                ",
                [],
                |row| row.get(0),
            )
            .expect("active session table query should succeed");

        assert_eq!(completed_count, 1);
        assert_eq!(active_count, 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn stores_completed_session_duration() {
        let path = temp_db_path("session");

        initialize_database(&path).expect("database should initialize");

        insert_completed_session(&path, "1142710", "Total War: WARHAMMER III", 1_000, 4_600)
            .expect("session should save");

        let connection = Connection::open(&path).expect("database should reopen");

        let (app_id, game_name, duration): (String, String, i64) = connection
            .query_row(
                "
                SELECT app_id, game_name, duration_seconds
                FROM game_sessions
                LIMIT 1
                ",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("session should exist");

        assert_eq!(app_id, "1142710");
        assert_eq!(game_name, "Total War: WARHAMMER III");
        assert_eq!(duration, 3_600);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn handles_zero_or_negative_duration_safely() {
        let path = temp_db_path("duration");

        initialize_database(&path).expect("database should initialize");

        insert_completed_session(&path, "1267910", "Melvor Idle", 5_000, 4_000)
            .expect("session should save");

        let connection = Connection::open(&path).expect("database should reopen");

        let duration: i64 = connection
            .query_row(
                "
                SELECT duration_seconds
                FROM game_sessions
                LIMIT 1
                ",
                [],
                |row| row.get(0),
            )
            .expect("session should exist");

        assert_eq!(duration, 0);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn active_session_heartbeat_updates_last_seen() {
        let path = temp_db_path("heartbeat");

        initialize_database(&path).expect("database should initialize");

        start_active_session(&path, "1267910", "Melvor Idle", 1_000)
            .expect("active session should start");

        touch_active_session(&path, "1267910", 1_010)
            .expect("active session heartbeat should update");

        let sessions = load_active_sessions(&path).expect("active sessions should load");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].started_at, 1_000);
        assert_eq!(sessions[0].last_seen_at, 1_010);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn analytics_summary_aggregates_completed_sessions() {
        let path = temp_db_path("summary");

        initialize_database(&path).expect("database should initialize");

        insert_completed_session(&path, "100", "Game One", 1_000, 1_600)
            .expect("first session should save");

        insert_completed_session(&path, "100", "Game One", 2_000, 3_200)
            .expect("second session should save");

        insert_completed_session(&path, "200", "Game Two", 4_000, 4_300)
            .expect("third session should save");

        let summary = get_analytics_summary(&path).expect("analytics summary should load");

        assert_eq!(summary.session_count, 3);
        assert_eq!(summary.total_seconds, 2_100);
        assert_eq!(summary.unique_games, 2);

        assert_eq!(summary.top_games.len(), 2);
        assert_eq!(summary.top_games[0].app_id, "100");
        assert_eq!(summary.top_games[0].game_name, "Game One");
        assert_eq!(summary.top_games[0].total_seconds, 1_800);
        assert_eq!(summary.top_games[0].session_count, 2);

        assert_eq!(summary.recent_sessions.len(), 3);
        assert_eq!(summary.recent_sessions[0].app_id, "200");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn completing_active_session_moves_it_to_history() {
        let path = temp_db_path("complete");

        initialize_database(&path).expect("database should initialize");

        start_active_session(&path, "4541930", "The Undercut: Racing Manager", 2_000)
            .expect("active session should start");

        touch_active_session(&path, "4541930", 2_030)
            .expect("active session heartbeat should update");

        let completed = complete_active_session(&path, "4541930", 2_030)
            .expect("active session should complete");

        assert!(completed);
        assert!(load_active_sessions(&path)
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

        assert_eq!(duration, 30);

        let _ = fs::remove_file(path);
    }
}
