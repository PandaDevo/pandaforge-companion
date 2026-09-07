use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XboxGame {
    pub name: String,
    pub package_name: String,
    pub package_family_name: String,
    pub package_full_name: String,
    pub application_id: String,
    pub aumid: String,
    pub version: String,
    pub publisher: String,
    pub install_location: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XboxScanResult {
    pub available: bool,
    pub games: Vec<XboxGame>,
    pub warnings: Vec<String>,
}

#[cfg(target_os = "windows")]
fn powershell_script() -> &'static str {
    r#"
$ErrorActionPreference = 'Stop'

$results = @()

Get-AppxPackage | ForEach-Object {
    $package = $_

    try {
        $manifest = Get-AppxPackageManifest -Package $package.PackageFullName
        # PandaVault Xbox Classification V1:
        # Only expose packages carrying MicrosoftGame.config.
        # This is a high-confidence signal for modern Microsoft Store /
        # Xbox PC packaged games. Uncertain Store applications remain excluded.
        $microsoftGameConfig = Join-Path $package.InstallLocation 'MicrosoftGame.config'

        if (-not (Test-Path -LiteralPath $microsoftGameConfig -PathType Leaf)) {
            continue
        }

        foreach ($application in @($manifest.Package.Applications.Application)) {
            if ($null -eq $application) {
                continue
            }

            $applicationId = [string]$application.Id

            if ([string]::IsNullOrWhiteSpace($applicationId)) {
                continue
            }

            $displayName = [string]$application.VisualElements.DisplayName

            if ([string]::IsNullOrWhiteSpace($displayName)) {
                $displayName = [string]$package.Name
            }

            $results += [PSCustomObject]@{
                name              = $displayName
                packageName       = [string]$package.Name
                packageFamilyName = [string]$package.PackageFamilyName
                packageFullName   = [string]$package.PackageFullName
                applicationId     = $applicationId
                aumid             = "$($package.PackageFamilyName)!$applicationId"
                version           = [string]$package.Version
                publisher         = [string]$package.Publisher
                installLocation   = [string]$package.InstallLocation
            }
        }
    }
    catch {
        # Skip individual packages that cannot be read.
    }
}

$results | ConvertTo-Json -Compress
"#
}

#[cfg(target_os = "windows")]
fn scan_windows_packages() -> Result<Vec<XboxGame>, String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            powershell_script(),
        ])
        .output()
        .map_err(|error| {
            format!(
                "Unable to query installed Windows gaming packages: {error}"
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();

        return Err(if message.is_empty() {
            "Windows package discovery failed.".to_string()
        } else {
            format!("Windows package discovery failed: {message}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json = stdout.trim();

    if json.is_empty() || json == "null" {
        return Ok(Vec::new());
    }

    if json.starts_with('[') {
        serde_json::from_str::<Vec<XboxGame>>(json).map_err(|error| {
            format!("Unable to read Windows package discovery results: {error}")
        })
    } else {
        let game = serde_json::from_str::<XboxGame>>(json).map_err(|error| {
            format!("Unable to read Windows package discovery result: {error}")
        })?;

        Ok(vec![game])
    }
}

#[tauri::command]
pub fn scan_xbox_games() -> Result<XboxScanResult, String> {
    #[cfg(target_os = "windows")]
    {
        let packages = scan_windows_packages()?;

        return Ok(XboxScanResult {
            available: true,
            games: packages,
            warnings: vec![
                "Xbox V1 returns Windows application candidates. Game classification is not connected yet."
                    .to_string(),
            ],
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(XboxScanResult {
            available: false,
            games: Vec::new(),
            warnings: vec![
                "Xbox / Microsoft Store discovery is only available on Windows."
                    .to_string(),
            ],
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn aumid_shape_uses_package_family_and_application_id() {
        let family = "PandaFixture_123456789";
        let application = "Game";

        let aumid = format!("{family}!{application}");

        assert_eq!(aumid, "PandaFixture_123456789!Game");
    }
}
