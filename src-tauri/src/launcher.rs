use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub source: String,
    pub game_id: String,
    pub launched: bool,
}

fn validate_identifier(value: &str) -> Result<&str, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err("Game identifier cannot be empty.".to_string());
    }

    if value.len() > 128 {
        return Err("Game identifier is too long.".to_string());
    }

    Ok(value)
}

fn launch_steam(game_id: &str) -> Result<(), String> {
    let app_id = validate_identifier(game_id)?;

    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Steam game identifier is invalid.".to_string());
    }

    let steam_uri = format!("steam://run/{app_id}");

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &steam_uri])
            .spawn()
            .map_err(|error| format!("Unable to ask Steam to launch the game: {error}"))?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&steam_uri)
            .spawn()
            .map_err(|error| format!("Unable to ask Steam to launch the game: {error}"))?;

        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&steam_uri)
            .spawn()
            .map_err(|error| format!("Unable to ask Steam to launch the game: {error}"))?;

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Launching Steam games is not supported on this platform.".to_string())
}

fn validate_xbox_aumid(value: &str) -> Result<&str, String> {
    let aumid = validate_identifier(value)?;

    let Some((package_family, application_id)) = aumid.split_once('!') else {
        return Err("Xbox game identifier is not a valid AUMID.".to_string());
    };

    if package_family.is_empty() || application_id.is_empty() {
        return Err("Xbox game identifier is not a valid AUMID.".to_string());
    }

    let is_safe = aumid.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(character, '.' | '-' | '_' | '!')
    });

    if !is_safe {
        return Err("Xbox game identifier contains unsupported characters.".to_string());
    }

    Ok(aumid)
}

fn launch_xbox(game_id: &str) -> Result<(), String> {
    let aumid = validate_xbox_aumid(game_id)?;

    #[cfg(target_os = "windows")]
    {
        let target = format!("shell:AppsFolder\\{aumid}");

        Command::new("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|error| {
                format!("Unable to ask Windows to launch the Xbox game: {error}")
            })?;

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = aumid;

        Err("Xbox / Microsoft Store launching is only supported on Windows.".to_string())
    }
}
#[tauri::command]
pub fn launch_game(source: String, game_id: String) -> Result<LaunchResult, String> {
    let normalized_source = source.trim().to_ascii_lowercase();
    let game_id = validate_identifier(&game_id)?.to_string();

    match normalized_source.as_str() {
        "steam" => launch_steam(&game_id)?,
        "epic" => {
            return Err("Epic Games launching is not connected yet.".to_string());
        }
        "xbox" | "microsoft" => launch_xbox(&game_id)?,
        "gog" => {
            return Err("GOG launching is not connected yet.".to_string());
        }
        "ea" => {
            return Err("EA app launching is not connected yet.".to_string());
        }
        "ubisoft" => {
            return Err("Ubisoft Connect launching is not connected yet.".to_string());
        }
        "manual" => {
            return Err("Manual game launching is not connected yet.".to_string());
        }
        _ => {
            return Err(format!(
                "PandaVault does not recognise the game source '{}'.",
                source.trim()
            ));
        }
    }

    Ok(LaunchResult {
        source: normalized_source,
        game_id,
        launched: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_numeric_steam_ids() {
        assert_eq!(validate_identifier("1142710").unwrap(), "1142710");
    }

    #[test]
    fn rejects_empty_identifiers() {
        assert!(validate_identifier("   ").is_err());
    }

    #[test]
    fn accepts_valid_xbox_aumids() {
        let aumid = "PandaFixture_123456789!Game";

        assert_eq!(validate_xbox_aumid(aumid).unwrap(), aumid);
    }

    #[test]
    fn rejects_xbox_identifier_without_application_separator() {
        assert!(validate_xbox_aumid("PandaFixture_123456789").is_err());
    }

    #[test]
    fn rejects_unsafe_xbox_aumids() {
        assert!(validate_xbox_aumid("PandaFixture_123!Game & calc").is_err());
    }
    #[test]
    fn steam_ids_must_be_numeric() {
        let invalid = "1142710 & something";

        assert!(!invalid
            .chars()
            .all(|character| character.is_ascii_digit()));
    }
}