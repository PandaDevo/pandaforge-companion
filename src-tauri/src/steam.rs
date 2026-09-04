use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGame {
    pub app_id: String,
    pub name: String,
    pub install_dir: String,
    pub install_path: String,
    pub library_path: String,
    pub size_on_disk: u64,
    pub build_id: String,
    pub state_flags: u64,
    pub last_updated: u64,
    pub last_played: u64,
    pub steam_playtime_minutes: Option<u64>,
    pub steam_playtime_2weeks_minutes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamScanResult {
    pub steam_path: String,
    pub library_paths: Vec<String>,
    pub games: Vec<SteamGame>,
}

fn parse_quoted_pair(line: &str) -> Option<(String, String)> {
    let mut values = Vec::with_capacity(2);
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }

        let mut value = String::new();

        while let Some(ch) = chars.next() {
            match ch {
                '"' => {
                    values.push(value);
                    break;
                }
                '\\' => match chars.peek().copied() {
                    Some('\\') => {
                        chars.next();
                        value.push('\\');
                    }
                    Some('"') => {
                        chars.next();
                        value.push('"');
                    }
                    _ => value.push('\\'),
                },
                _ => value.push(ch),
            }
        }

        if values.len() == 2 {
            break;
        }
    }

    match values.as_slice() {
        [key, value] => Some((key.clone(), value.clone())),
        _ => None,
    }
}

fn normalize_steam_path(value: &str) -> PathBuf {
    let unescaped = value.replace("\\\\", "\\");
    PathBuf::from(unescaped.replace('/', "\\"))
}
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SteamPlaytime {
    lifetime_minutes: Option<u64>,
    two_weeks_minutes: Option<u64>,
}

fn brace_delta(line: &str) -> i32 {
    let mut delta = 0_i32;
    let mut in_quotes = false;
    let mut escaped = false;

    for ch in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }

        if ch == '\\' && in_quotes {
            escaped = true;
            continue;
        }

        if ch == '"' {
            in_quotes = !in_quotes;
            continue;
        }

        if in_quotes {
            continue;
        }

        match ch {
            '{' => delta += 1,
            '}' => delta -= 1,
            _ => {}
        }
    }

    delta
}

fn parse_localconfig_playtimes(contents: &str) -> HashMap<String, SteamPlaytime> {
    let lines: Vec<&str> = contents.lines().collect();
    let mut results = HashMap::new();

    let mut index = 0_usize;

    while index < lines.len() {
        let trimmed = lines[index].trim();

        let Some(app_id) = trimmed
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        else {
            index += 1;
            continue;
        };

        let mut cursor = index + 1;

        while cursor < lines.len() && lines[cursor].trim().is_empty() {
            cursor += 1;
        }

        if cursor >= lines.len() || lines[cursor].trim() != "{" {
            index += 1;
            continue;
        }

        let mut depth = 1_i32;
        let mut playtime = SteamPlaytime::default();
        cursor += 1;

        while cursor < lines.len() && depth > 0 {
            let line = lines[cursor];

            if depth > 0 {
                if let Some((key, value)) = parse_quoted_pair(line) {
                    match key.as_str() {
                        "Playtime" => playtime.lifetime_minutes = value.parse().ok(),
                        "Playtime2wks" => playtime.two_weeks_minutes = value.parse().ok(),
                        _ => {}
                    }
                }
            }

            depth += brace_delta(line);
            cursor += 1;
        }

        if playtime.lifetime_minutes.is_some() || playtime.two_weeks_minutes.is_some() {
            results
                .entry(app_id.to_string())
                .and_modify(|existing: &mut SteamPlaytime| {
                    if playtime.lifetime_minutes.is_some() {
                        existing.lifetime_minutes = playtime.lifetime_minutes;
                    }

                    if playtime.two_weeks_minutes.is_some() {
                        existing.two_weeks_minutes = playtime.two_weeks_minutes;
                    }
                })
                .or_insert(playtime);
        }

        index = cursor.max(index + 1);
    }

    results
}

fn read_local_steam_playtimes(steam_path: &Path) -> HashMap<String, SteamPlaytime> {
    let userdata = steam_path.join("userdata");

    if !userdata.is_dir() {
        return HashMap::new();
    }

    let Ok(account_entries) = fs::read_dir(userdata) else {
        return HashMap::new();
    };

    let mut playtimes = HashMap::new();

    for entry in account_entries.flatten() {
        let config_path = entry.path().join("config").join("localconfig.vdf");

        if !config_path.is_file() {
            continue;
        }

        let Ok(contents) = fs::read_to_string(config_path) else {
            continue;
        };

        for (app_id, playtime) in parse_localconfig_playtimes(&contents) {
            playtimes
                .entry(app_id)
                .and_modify(|existing: &mut SteamPlaytime| {
                    if playtime.lifetime_minutes.is_some() {
                        existing.lifetime_minutes = playtime.lifetime_minutes;
                    }

                    if playtime.two_weeks_minutes.is_some() {
                        existing.two_weeks_minutes = playtime.two_weeks_minutes;
                    }
                })
                .or_insert(playtime);
        }
    }

    playtimes
}

fn apply_local_steam_playtimes(games: &mut [SteamGame]) {
    let Ok(steam_path) = detect_steam_path() else {
        return;
    };

    let playtimes = read_local_steam_playtimes(&steam_path);

    for game in games {
        if let Some(playtime) = playtimes.get(&game.app_id) {
            game.steam_playtime_minutes = playtime.lifetime_minutes;
            game.steam_playtime_2weeks_minutes = playtime.two_weeks_minutes;
        }
    }
}

fn steam_path_from_registry() -> Option<PathBuf> {
    let output = Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        let trimmed = line.trim();

        if !trimmed.starts_with("SteamPath") {
            continue;
        }

        let value = trimmed
            .split_once("REG_SZ")
            .map(|(_, value)| value.trim())
            .filter(|value| !value.is_empty())?;

        return Some(normalize_steam_path(value));
    }

    None
}

fn detect_steam_path() -> Result<PathBuf, String> {
    if let Some(path) = steam_path_from_registry() {
        if path.exists() {
            return Ok(path);
        }
    }

    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        let fallback = PathBuf::from(program_files_x86).join("Steam");

        if fallback.exists() {
            return Ok(fallback);
        }
    }

    Err("Steam installation could not be found.".to_string())
}

fn read_library_paths(steam_path: &Path) -> Result<Vec<PathBuf>, String> {
    let library_file = steam_path.join("steamapps").join("libraryfolders.vdf");

    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    let default_path = steam_path.to_path_buf();
    seen.insert(default_path.to_string_lossy().to_lowercase());
    paths.push(default_path);

    if !library_file.exists() {
        return Ok(paths);
    }

    let contents = fs::read_to_string(&library_file).map_err(|error| {
        format!(
            "Unable to read Steam library file '{}': {error}",
            library_file.display()
        )
    })?;

    for line in contents.lines() {
        let Some((key, value)) = parse_quoted_pair(line) else {
            continue;
        };

        if key != "path" {
            continue;
        }

        let path = normalize_steam_path(&value);
        let identity = path.to_string_lossy().to_lowercase();

        if seen.insert(identity) {
            paths.push(path);
        }
    }

    Ok(paths)
}

fn parse_manifest(path: &Path, library_path: &Path) -> Result<SteamGame, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read '{}': {error}", path.display()))?;

    let mut app_id = String::new();
    let mut name = String::new();
    let mut install_dir = String::new();
    let mut size_on_disk = 0_u64;
    let mut build_id = String::new();
    let mut state_flags = 0_u64;
    let mut last_updated = 0_u64;
    let mut last_played = 0_u64;

    for line in contents.lines() {
        let Some((key, value)) = parse_quoted_pair(line) else {
            continue;
        };

        match key.as_str() {
            "appid" => app_id = value,
            "name" => name = value,
            "installdir" => install_dir = value,
            "SizeOnDisk" => size_on_disk = value.parse().unwrap_or(0),
            "buildid" => build_id = value,
            "StateFlags" => state_flags = value.parse().unwrap_or(0),
            "LastUpdated" => last_updated = value.parse().unwrap_or(0),
            "LastPlayed" => last_played = value.parse().unwrap_or(0),
            _ => {}
        }
    }

    if app_id.is_empty() {
        return Err(format!("Manifest '{}' has no appid.", path.display()));
    }

    if name.is_empty() {
        return Err(format!("Manifest '{}' has no name.", path.display()));
    }

    if install_dir.is_empty() {
        return Err(format!("Manifest '{}' has no installdir.", path.display()));
    }

    let install_path = library_path
        .join("steamapps")
        .join("common")
        .join(&install_dir);

    Ok(SteamGame {
        app_id,
        name,
        install_dir,
        install_path: install_path.to_string_lossy().to_string(),
        library_path: library_path.to_string_lossy().to_string(),
        size_on_disk,
        build_id,
        state_flags,
        last_updated,
        last_played,
        steam_playtime_minutes: None,
        steam_playtime_2weeks_minutes: None,
    })
}

#[tauri::command]
pub fn scan_steam_games() -> Result<SteamScanResult, String> {
    let steam_path = detect_steam_path()?;
    let library_paths = read_library_paths(&steam_path)?;

    let mut games = Vec::new();

    for library_path in &library_paths {
        let steamapps = library_path.join("steamapps");

        if !steamapps.exists() {
            continue;
        }

        let entries = fs::read_dir(&steamapps).map_err(|error| {
            format!(
                "Unable to read Steam library '{}': {error}",
                steamapps.display()
            )
        })?;

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };

            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }

            if let Ok(game) = parse_manifest(&path, library_path) {
                if is_user_visible_game(&game) {
                    games.push(game);
                }
            }
        }
    }

    apply_local_steam_playtimes(&mut games);

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(SteamScanResult {
        steam_path: steam_path.to_string_lossy().to_string(),
        library_paths: library_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        games,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedLibraryScanResult {
    pub approved_paths: Vec<String>,
    pub steam_library_paths: Vec<String>,
    pub games: Vec<SteamGame>,
    pub warnings: Vec<String>,
}

fn path_identity(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    let identity = path_identity(&path);

    if seen.insert(identity) {
        paths.push(path);
    }
}

fn discover_steam_roots(approved_path: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    if approved_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        if let Some(parent) = approved_path.parent() {
            push_unique_path(&mut roots, &mut seen, parent.to_path_buf());
        }
    }

    if approved_path.join("steamapps").is_dir() {
        push_unique_path(&mut roots, &mut seen, approved_path.to_path_buf());
    }

    for common_name in ["SteamLibrary", "Steam"] {
        let candidate = approved_path.join(common_name);

        if candidate.join("steamapps").is_dir() {
            push_unique_path(&mut roots, &mut seen, candidate);
        }
    }

    if let Ok(entries) = fs::read_dir(approved_path) {
        for entry in entries.flatten() {
            let candidate = entry.path();

            if candidate.is_dir() && candidate.join("steamapps").is_dir() {
                push_unique_path(&mut roots, &mut seen, candidate);
            }
        }
    }

    roots
}

fn is_user_visible_game(game: &SteamGame) -> bool {
    !matches!(
        game.app_id.as_str(),
        "228980" // Steamworks Common Redistributables
    )
}

fn scan_library_manifests(library_path: &Path) -> Result<Vec<SteamGame>, String> {
    let steamapps = library_path.join("steamapps");

    if !steamapps.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&steamapps).map_err(|error| {
        format!(
            "Unable to read Steam library '{}': {error}",
            steamapps.display()
        )
    })?;

    let mut games = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
            continue;
        }

        if let Ok(game) = parse_manifest(&path, library_path) {
            games.push(game);
        }
    }

    Ok(games)
}

#[tauri::command]
pub fn scan_approved_libraries(paths: Vec<String>) -> Result<ApprovedLibraryScanResult, String> {
    let mut approved_paths = Vec::new();
    let mut steam_library_paths = Vec::new();
    let mut steam_library_seen = HashSet::new();
    let mut warnings = Vec::new();

    for value in paths {
        let approved = normalize_steam_path(&value);
        approved_paths.push(approved.to_string_lossy().to_string());

        if !approved.exists() {
            warnings.push(format!(
                "Approved location is currently unavailable: {}",
                approved.display()
            ));
            continue;
        }

        for root in discover_steam_roots(&approved) {
            let identity = path_identity(&root);

            if steam_library_seen.insert(identity) {
                steam_library_paths.push(root);
            }
        }
    }

    let mut games = Vec::new();
    let mut game_ids = HashSet::new();

    for library_path in &steam_library_paths {
        match scan_library_manifests(library_path) {
            Ok(found_games) => {
                for game in found_games {
                    if is_user_visible_game(&game) && game_ids.insert(game.app_id.clone()) {
                        games.push(game);
                    }
                }
            }
            Err(error) => warnings.push(error),
        }
    }

    apply_local_steam_playtimes(&mut games);

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(ApprovedLibraryScanResult {
        approved_paths,
        steam_library_paths: steam_library_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        games,
        warnings,
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_vdf_pair() {
        let result = parse_quoted_pair(r#""name"          "Total War: WARHAMMER III""#);

        assert_eq!(
            result,
            Some(("name".to_string(), "Total War: WARHAMMER III".to_string()))
        );
    }

    #[test]
    fn parses_escaped_windows_path() {
        let result = parse_quoted_pair(
            r#""LauncherPath"          "C:\\Program Files (x86)\\Steam\\steam.exe""#,
        );

        assert_eq!(
            result,
            Some((
                "LauncherPath".to_string(),
                r"C:\Program Files (x86)\Steam\steam.exe".to_string()
            ))
        );
    }

    #[test]
    fn hides_steamworks_common_redistributables() {
        let game = SteamGame {
            app_id: "228980".to_string(),
            name: "Steamworks Common Redistributables".to_string(),
            install_dir: "Steamworks Shared".to_string(),
            install_path: String::new(),
            library_path: String::new(),
            size_on_disk: 0,
            build_id: String::new(),
            state_flags: 0,
            last_updated: 0,
            last_played: 0,
            steam_playtime_minutes: None,
            steam_playtime_2weeks_minutes: None,
        };

        assert!(!is_user_visible_game(&game));
    }

    #[test]
    fn parses_localconfig_playtime_block() {
        let contents = r#"
"Software"
{
    "Valve"
    {
        "Steam"
        {
            "apps"
            {
                "4514930"
                {
                    "Playtime2wks"      "486"
                    "Playtime"          "486"
                }
            }
        }
    }
}
"#;

        let playtimes = parse_localconfig_playtimes(contents);
        let game = playtimes.get("4514930").expect("playtime should exist");

        assert_eq!(game.lifetime_minutes, Some(486));
        assert_eq!(game.two_weeks_minutes, Some(486));
    }

    #[test]
    fn ignores_unrelated_playtime_blocks() {
        let contents = r#"
"apps"
{
    "111"
    {
        "Playtime"      "12"
    }

    "4514930"
    {
        "Playtime"      "486"
    }

    "222"
    {
        "Playtime"      "999"
    }
}
"#;

        let playtimes = parse_localconfig_playtimes(contents);

        assert_eq!(
            playtimes
                .get("4514930")
                .and_then(|value| value.lifetime_minutes),
            Some(486)
        );
        assert_eq!(
            playtimes
                .get("111")
                .and_then(|value| value.lifetime_minutes),
            Some(12)
        );
        assert_eq!(
            playtimes
                .get("222")
                .and_then(|value| value.lifetime_minutes),
            Some(999)
        );
    }
    #[test]
    fn preserves_normal_windows_path() {
        let result = parse_quoted_pair(r#""path"          "C:\Program Files (x86)\Steam""#);

        assert_eq!(
            result,
            Some((
                "path".to_string(),
                r"C:\Program Files (x86)\Steam".to_string()
            ))
        );
    }
}
