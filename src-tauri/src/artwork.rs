use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameArtwork {
    pub app_id: String,
    pub artwork_path: Option<String>,
}

fn find_named_file_recursive(directory: &Path, names: &[&str]) -> Option<PathBuf> {
    if !directory.is_dir() {
        return None;
    }

    let entries = fs::read_dir(directory).ok()?;

    let mut directories = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_file() {
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };

            if names
                .iter()
                .any(|candidate| file_name.eq_ignore_ascii_case(candidate))
            {
                return Some(path);
            }
        } else if path.is_dir() {
            directories.push(path);
        }
    }

    for directory in directories {
        if let Some(found) = find_named_file_recursive(&directory, names) {
            return Some(found);
        }
    }

    None
}

fn find_steam_portrait(steam_path: &Path, app_id: &str) -> Option<PathBuf> {
    let app_cache = steam_path
        .join("appcache")
        .join("librarycache")
        .join(app_id);

    // Steam currently uses both layouts:
    //
    // <appid>\library_600x900.jpg
    //
    // and newer hashed subdirectories such as:
    //
    // <appid>\<hash>\library_capsule.jpg
    //
    // Search only inside this AppID's cache folder.
    find_named_file_recursive(
        &app_cache,
        &[
            "library_600x900.jpg",
            "library_600x900.png",
            "library_capsule.jpg",
            "library_capsule.png",
        ],
    )
}

fn cached_extension(source: &Path) -> &'static str {
    match source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "png",
        _ => "jpg",
    }
}

fn import_one_artwork(steam_path: &Path, cache_directory: &Path, app_id: &str) -> Option<String> {
    let source = find_steam_portrait(steam_path, app_id)?;
    let extension = cached_extension(&source);
    let destination = cache_directory.join(format!("{app_id}.{extension}"));

    let should_copy = match (fs::metadata(&source), fs::metadata(&destination)) {
        (Ok(source_metadata), Ok(destination_metadata)) => {
            source_metadata.len() != destination_metadata.len()
                || source_metadata.modified().ok() != destination_metadata.modified().ok()
        }
        _ => true,
    };

    if should_copy {
        if fs::copy(&source, &destination).is_err() {
            return None;
        }
    }

    Some(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_steam_artwork(
    app: tauri::AppHandle,
    steam_path: String,
    app_ids: Vec<String>,
) -> Result<Vec<GameArtwork>, String> {
    let steam_path = PathBuf::from(steam_path);

    if !steam_path.is_dir() {
        return Err(format!(
            "Steam installation is unavailable: {}",
            steam_path.display()
        ));
    }

    let data_directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve PandaVault local data directory: {error}"))?;

    let cache_directory = data_directory.join("game-artwork");

    fs::create_dir_all(&cache_directory).map_err(|error| {
        format!(
            "Unable to create PandaVault artwork cache '{}': {error}",
            cache_directory.display()
        )
    })?;

    let artwork = app_ids
        .into_iter()
        .map(|app_id| {
            let artwork_path = import_one_artwork(&steam_path, &cache_directory, &app_id);

            GameArtwork {
                app_id,
                artwork_path,
            }
        })
        .collect();

    Ok(artwork)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_supported_artwork_extensions() {
        assert_eq!(cached_extension(Path::new("library_600x900.jpg")), "jpg");
        assert_eq!(cached_extension(Path::new("library_capsule.png")), "png");
    }
}
