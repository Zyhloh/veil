use serde::{Deserialize, Serialize};
use std::process::Command;

const REPO: &str = "Zyhloh/veil";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub asset_name: String,
    pub release_notes: String,
    pub release_url: String,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

fn parse_version(s: &str) -> Vec<u32> {
    s.trim()
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .split('.')
        .map(|p| {
            p.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

fn version_gt(latest: &str, current: &str) -> bool {
    let l = parse_version(latest);
    let c = parse_version(current);
    let n = l.len().max(c.len());
    for i in 0..n {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Veil/{} (+https://github.com/{})", CURRENT_VERSION, REPO))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let client = build_client()?;

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let release: GhRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    if release.draft || release.prerelease {
        return Ok(UpdateInfo {
            available: false,
            current_version: CURRENT_VERSION.to_string(),
            latest_version: release.tag_name,
            download_url: String::new(),
            asset_name: String::new(),
            release_notes: release.body.unwrap_or_default(),
            release_url: release.html_url,
        });
    }

    let asset = release
        .assets
        .iter()
        .find(|a| a.name.to_lowercase().ends_with("-setup.exe"))
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|a| a.name.to_lowercase().ends_with(".exe"))
        });

    let (download_url, asset_name) = match asset {
        Some(a) => (a.browser_download_url.clone(), a.name.clone()),
        None => (String::new(), String::new()),
    };

    let available =
        version_gt(&release.tag_name, CURRENT_VERSION) && !download_url.is_empty();

    Ok(UpdateInfo {
        available,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: release.tag_name,
        download_url,
        asset_name,
        release_notes: release.body.unwrap_or_default(),
        release_url: release.html_url,
    })
}

#[tauri::command]
pub async fn download_and_run_update(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    use std::io::Write;

    if url.is_empty() {
        return Err("No download URL provided".into());
    }
    if !url.starts_with("https://github.com/")
        && !url.starts_with("https://objects.githubusercontent.com/")
    {
        return Err("Refusing to download from unexpected host".into());
    }

    let client = build_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read body failed: {}", e))?;

    let filename = url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("Veil-setup.exe");

    let installer_path = std::env::temp_dir().join(filename);
    {
        let mut f = std::fs::File::create(&installer_path)
            .map_err(|e| format!("Failed to create installer file: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Failed to write installer: {}", e))?;
    }

    Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(400));
    app.exit(0);

    Ok(installer_path.display().to_string())
}
