use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicGame {
    pub app_name: String,
    pub name: String,
    pub install_path: String,
    pub install_size: u64,
    pub version: Option<String>,
    pub catalog_namespace: Option<String>,
    pub catalog_item_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicScanResult {
    pub launcher_found: bool,
    pub manifest_directory_found: bool,
    pub manifest_path: String,
    pub games: Vec<EpicGame>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicManifest {
    #[serde(default)]
    app_name: String,

    #[serde(default)]
    display_name: String,

    #[serde(default)]
    install_location: String,

    #[serde(default)]
    install_size: u64,

    #[serde(default)]
    app_version_string: String,

    #[serde(default)]
    catalog_namespace: String,

    #[serde(default)]
    catalog_item_id: String,

    #[serde(default, rename = "bIsExecutable")]
    is_executable: Option<bool>,
}

fn optional_string(value: String) -> Option<String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn epic_manifest_directory() -> Option<PathBuf> {
    env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .map(|program_data| {
            program_data
                .join("Epic")
                .join("EpicGamesLauncher")
                .join("Data")
                .join("Manifests")
        })
}

fn epic_launcher_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(program_files_x86) = env::var_os("PROGRAMFILES(X86)") {
        candidates.push(
            PathBuf::from(program_files_x86)
                .join("Epic Games")
                .join("Launcher")
                .join("Portal")
                .join("Binaries")
                .join("Win64")
                .join("EpicGamesLauncher.exe"),
        );
    }

    if let Some(program_files) = env::var_os("PROGRAMFILES") {
        candidates.push(
            PathBuf::from(program_files)
                .join("Epic Games")
                .join("Launcher")
                .join("Portal")
                .join("Binaries")
                .join("Win64")
                .join("EpicGamesLauncher.exe"),
        );
    }

    candidates
}

fn detect_epic_launcher() -> bool {
    epic_launcher_candidates()
        .iter()
        .any(|candidate| candidate.is_file())
}

fn parse_manifest(path: &Path) -> Result<Option<EpicGame>, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read Epic manifest '{}': {error}", path.display()))?;

    let manifest: EpicManifest = serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse Epic manifest '{}': {error}", path.display()))?;

    let app_name = manifest.app_name.trim().to_string();
    let name = manifest.display_name.trim().to_string();
    let install_location = manifest.install_location.trim().to_string();

    if app_name.is_empty() {
        return Err(format!(
            "Epic manifest '{}' has no AppName.",
            path.display()
        ));
    }

    if name.is_empty() {
        return Err(format!(
            "Epic manifest '{}' has no DisplayName.",
            path.display()
        ));
    }

    if install_location.is_empty() {
        return Err(format!(
            "Epic manifest '{}' has no InstallLocation.",
            path.display()
        ));
    }

    if manifest.is_executable == Some(false) {
        return Ok(None);
    }

    let install_path = PathBuf::from(&install_location);

    if !install_path.is_dir() {
        return Ok(None);
    }

    Ok(Some(EpicGame {
        app_name,
        name,
        install_path: install_path.to_string_lossy().to_string(),
        install_size: manifest.install_size,
        version: optional_string(manifest.app_version_string),
        catalog_namespace: optional_string(manifest.catalog_namespace),
        catalog_item_id: optional_string(manifest.catalog_item_id),
    }))
}

#[tauri::command]
pub fn scan_epic_games() -> Result<EpicScanResult, String> {
    let launcher_found = detect_epic_launcher();

    let Some(manifest_directory) = epic_manifest_directory() else {
        return Ok(EpicScanResult {
            launcher_found,
            manifest_directory_found: false,
            manifest_path: String::new(),
            games: Vec::new(),
            warnings: vec![
                "Windows PROGRAMDATA is unavailable, so Epic manifests cannot be located."
                    .to_string(),
            ],
        });
    };

    let manifest_path = manifest_directory.to_string_lossy().to_string();

    if !manifest_directory.is_dir() {
        return Ok(EpicScanResult {
            launcher_found,
            manifest_directory_found: false,
            manifest_path,
            games: Vec::new(),
            warnings: Vec::new(),
        });
    }

    let entries = fs::read_dir(&manifest_directory).map_err(|error| {
        format!(
            "Unable to read Epic manifest directory '{}': {error}",
            manifest_directory.display()
        )
    })?;

    let mut games = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("Unable to inspect an Epic manifest entry: {error}"));
                continue;
            }
        };

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let is_item_manifest = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("item"))
            .unwrap_or(false);

        if !is_item_manifest {
            continue;
        }

        match parse_manifest(&path) {
            Ok(Some(game)) => {
                let identity = game.app_name.to_ascii_lowercase();

                if seen.insert(identity) {
                    games.push(game);
                }
            }
            Ok(None) => {}
            Err(error) => warnings.push(error),
        }
    }

    games.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
    });

    Ok(EpicScanResult {
        launcher_found,
        manifest_directory_found: true,
        manifest_path,
        games,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::{optional_string, EpicManifest};

    fn parse_fixture(json: &str) -> EpicManifest {
        serde_json::from_str(json).expect("fixture should parse")
    }

    #[test]
    fn optional_string_rejects_empty_values() {
        assert_eq!(optional_string("   ".to_string()), None);
    }

    #[test]
    fn optional_string_trims_real_values() {
        assert_eq!(
            optional_string("  1.2.3  ".to_string()),
            Some("1.2.3".to_string())
        );
    }

    #[test]
    fn epic_manifest_maps_expected_fields() {
        let manifest = parse_fixture(
            r#"{
                "AppName": "PandaFixture",
                "DisplayName": "Panda Fixture Game",
                "InstallLocation": "C:\\Games\\PandaFixture",
                "InstallSize": 123456789,
                "AppVersionString": "1.2.3",
                "CatalogNamespace": "fixture-namespace",
                "CatalogItemId": "fixture-item",
                "bIsExecutable": true
            }"#,
        );

        assert_eq!(manifest.app_name, "PandaFixture");
        assert_eq!(manifest.display_name, "Panda Fixture Game");
        assert_eq!(manifest.install_location, r"C:\Games\PandaFixture");
        assert_eq!(manifest.install_size, 123456789);
        assert_eq!(manifest.app_version_string, "1.2.3");
        assert_eq!(manifest.catalog_namespace, "fixture-namespace");
        assert_eq!(manifest.catalog_item_id, "fixture-item");
        assert_eq!(manifest.is_executable, Some(true));
    }

    #[test]
    fn epic_manifest_defaults_optional_and_missing_fields() {
        let manifest = parse_fixture(
            r#"{
                "AppName": "MinimalFixture",
                "DisplayName": "Minimal Fixture",
                "InstallLocation": "D:\\Games\\MinimalFixture"
            }"#,
        );

        assert_eq!(manifest.install_size, 0);
        assert_eq!(manifest.app_version_string, "");
        assert_eq!(manifest.catalog_namespace, "");
        assert_eq!(manifest.catalog_item_id, "");
        assert_eq!(manifest.is_executable, None);
    }

    #[test]
    fn epic_manifest_preserves_non_executable_flag() {
        let manifest = parse_fixture(
            r#"{
                "AppName": "ContentFixture",
                "DisplayName": "Content Fixture",
                "InstallLocation": "C:\\Content\\Fixture",
                "bIsExecutable": false
            }"#,
        );

        assert_eq!(manifest.is_executable, Some(false));
    }

    #[test]
    fn malformed_epic_manifest_is_rejected() {
        let result = serde_json::from_str::<EpicManifest>(
            r#"{"AppName":"BrokenFixture","DisplayName":"Broken""#,
        );

        assert!(result.is_err());
    }
}
