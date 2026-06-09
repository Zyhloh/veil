use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::config::{get_app_config, save_app_config};

const CLOUD_DLL_URL: &str = "https://app.projectveil.cc/dll/cloud_redirect.dll";
const HASHES_URL: &str = "https://app.projectveil.cc/dll/hashes";
const DLL_NAME: &str = "cloud_redirect.dll";
const LOG_NAME: &str = "cloud_redirect.log";
const DEFAULT_FOLDER_NAME: &str = "localcloud";

fn dll_path(steam_path: &str) -> PathBuf {
    Path::new(steam_path).join(DLL_NAME)
}

fn log_path(steam_path: &str) -> PathBuf {
    Path::new(steam_path).join(LOG_NAME)
}

fn cloud_config_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("Could not resolve %AppData%")?
        .join("CloudRedirect");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("config.json"))
}

fn default_folder(steam_path: &str) -> String {
    Path::new(steam_path)
        .join(DEFAULT_FOLDER_NAME)
        .to_string_lossy()
        .to_string()
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, data);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn file_sha256(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| sha256_hex(&b))
}

async fn fetch_remote_hashes() -> Option<HashMap<String, String>> {
    let client = http_client().ok()?;
    let resp = client.get(HASHES_URL).send().await.ok()?;
    let map: HashMap<String, String> = resp.json().await.ok()?;
    Some(map.into_iter().map(|(k, v)| (k, v.to_lowercase())).collect())
}

fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    clear_readonly(path);
    match fs::write(path, data) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = fs::remove_file(path);
            fs::write(path, data).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
        }
    }
}

async fn download_dll(hashes: Option<&HashMap<String, String>>) -> Result<Vec<u8>, String> {
    let client = http_client()?;
    let data = client
        .get(CLOUD_DLL_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Failed to download {}: {}", DLL_NAME, e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {}: {}", DLL_NAME, e))?
        .to_vec();
    if data.len() < 1024 || &data[0..2] != b"MZ" {
        return Err(format!("{}: downloaded file is not a valid DLL", DLL_NAME));
    }
    if let Some(expected) = hashes.and_then(|h| h.get(DLL_NAME)) {
        if !sha256_hex(&data).eq_ignore_ascii_case(expected) {
            return Err(format!("{}: hash mismatch after download", DLL_NAME));
        }
    }
    Ok(data)
}

async fn ensure_dll(steam_path: &str) -> Result<(), String> {
    let dest = dll_path(steam_path);
    let hashes = fetch_remote_hashes().await;

    if dest.exists() {
        match (hashes.as_ref().and_then(|h| h.get(DLL_NAME)), file_sha256(&dest)) {
            (Some(expected), Some(actual)) if actual.eq_ignore_ascii_case(expected) => return Ok(()),
            (Some(_), _) => {}
            _ => return Ok(()),
        }
    }

    let data = download_dll(hashes.as_ref()).await?;
    let _ = write_file(&dest, &data);
    Ok(())
}

async fn write_dll_forced(steam_path: &str, data: &[u8]) -> Result<(), String> {
    let dest = dll_path(steam_path);
    if write_file(&dest, data).is_err() {
        if super::steam::check_steam_running() {
            let _ = super::steam::kill_steam().await;
            std::thread::sleep(std::time::Duration::from_millis(800));
        }
        write_file(&dest, data)?;
    }
    Ok(())
}

fn read_config() -> Map<String, Value> {
    cloud_config_path()
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn current_folder(steam_path: &str) -> String {
    read_config()
        .get("sync_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default_folder(steam_path))
}

fn write_folder_config(folder: &str) -> Result<(), String> {
    let path = cloud_config_path()?;
    let mut obj = read_config();
    obj.insert("provider".into(), Value::String("folder".into()));
    obj.insert("sync_path".into(), Value::String(folder.to_string()));
    let json = serde_json::to_string_pretty(&Value::Object(obj)).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write config: {}", e))
}

fn apply_log_pref(steam_path: &str, log_enabled: bool) {
    let p = log_path(steam_path);
    if log_enabled {
        if p.is_dir() {
            let _ = fs::remove_dir_all(&p);
        }
        return;
    }
    if p.is_dir() {
        return;
    }
    let old = Path::new(steam_path).join("cloud_redirect.log.old");
    if old.exists() {
        clear_readonly(&old);
        let _ = fs::remove_file(&old);
    }
    if p.exists() {
        clear_readonly(&p);
        if fs::remove_file(&p).is_err() {
            return;
        }
    }
    let _ = fs::create_dir(&p);
}

fn set_enabled_pref(enabled: bool) {
    if let Ok(mut cfg) = get_app_config() {
        cfg.cloud_saves_enabled = enabled;
        let _ = save_app_config(cfg);
    }
}

fn set_log_pref(enabled: bool) {
    if let Ok(mut cfg) = get_app_config() {
        cfg.cloud_saves_log = enabled;
        let _ = save_app_config(cfg);
    }
}

async fn remove_dll_forced(steam_path: &str) {
    let dest = dll_path(steam_path);
    if !dest.exists() {
        return;
    }
    clear_readonly(&dest);
    if fs::remove_file(&dest).is_err() {
        if super::steam::check_steam_running() {
            let _ = super::steam::kill_steam().await;
            std::thread::sleep(std::time::Duration::from_millis(800));
        }
        clear_readonly(&dest);
        let _ = fs::remove_file(&dest);
    }
}

fn ensure_folder_config(folder: &str) {
    let cfg = read_config();
    let same = cfg.get("provider").and_then(|v| v.as_str()) == Some("folder")
        && cfg.get("sync_path").and_then(|v| v.as_str()) == Some(folder);
    if !same {
        let _ = write_folder_config(folder);
    }
}

#[derive(Serialize)]
pub struct CloudSavesStatus {
    pub enabled: bool,
    pub log_enabled: bool,
    pub sync_path: String,
    pub steam_running: bool,
}

fn build_status(steam_path: &str) -> CloudSavesStatus {
    let cfg = get_app_config().unwrap_or_default();
    CloudSavesStatus {
        enabled: cfg.cloud_saves_enabled,
        log_enabled: cfg.cloud_saves_log,
        sync_path: current_folder(steam_path),
        steam_running: super::steam::check_steam_running(),
    }
}

#[tauri::command]
pub fn cloud_saves_status(steam_path: String) -> Result<CloudSavesStatus, String> {
    Ok(build_status(&steam_path))
}

#[tauri::command]
pub async fn cloud_saves_ensure(steam_path: String) -> Result<CloudSavesStatus, String> {
    let cfg = get_app_config().unwrap_or_default();
    if !cfg.cloud_saves_enabled {
        return Ok(build_status(&steam_path));
    }

    let folder = current_folder(&steam_path);
    let _ = fs::create_dir_all(&folder);
    ensure_folder_config(&folder);

    let _ = ensure_dll(&steam_path).await;

    apply_log_pref(&steam_path, cfg.cloud_saves_log);
    Ok(build_status(&steam_path))
}

#[tauri::command]
pub async fn cloud_saves_enable(steam_path: String, folder: String) -> Result<CloudSavesStatus, String> {
    set_enabled_pref(true);

    let target = if folder.trim().is_empty() {
        current_folder(&steam_path)
    } else {
        folder
    };
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create folder: {}", e))?;
    write_folder_config(&target)?;

    let hashes = fetch_remote_hashes().await;
    let data = download_dll(hashes.as_ref()).await?;
    write_dll_forced(&steam_path, &data).await?;

    let cfg = get_app_config().unwrap_or_default();
    apply_log_pref(&steam_path, cfg.cloud_saves_log);

    Ok(build_status(&steam_path))
}

#[tauri::command]
pub async fn cloud_saves_disable(steam_path: String) -> Result<CloudSavesStatus, String> {
    set_enabled_pref(false);
    remove_dll_forced(&steam_path).await;
    Ok(build_status(&steam_path))
}

#[tauri::command]
pub fn cloud_saves_set_folder(steam_path: String, folder: String) -> Result<CloudSavesStatus, String> {
    if folder.trim().is_empty() {
        return Err("No folder provided".into());
    }
    fs::create_dir_all(&folder).map_err(|e| format!("Failed to create folder: {}", e))?;
    write_folder_config(&folder)?;
    Ok(build_status(&steam_path))
}

#[tauri::command]
pub fn cloud_saves_set_logging(steam_path: String, enabled: bool) -> Result<CloudSavesStatus, String> {
    set_log_pref(enabled);
    apply_log_pref(&steam_path, enabled);
    Ok(build_status(&steam_path))
}

fn dir_has_files(dir: &Path) -> bool {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&d) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    return true;
                }
            }
        }
    }
    false
}

fn zip_dir(src: &Path, dest: &Path) -> Result<u32, String> {
    let file = fs::File::create(dest).map_err(|e| format!("Failed to create zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0u32;
    let mut stack = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir failed: {}", e))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let rel = match path.strip_prefix(src) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if rel.is_empty() {
                continue;
            }
            if path.is_dir() {
                let _ = zip.add_directory(format!("{}/", rel), opts);
                stack.push(path);
            } else if let Ok(data) = fs::read(&path) {
                zip.start_file(rel, opts).map_err(|e| format!("Zip entry failed: {}", e))?;
                zip.write_all(&data).map_err(|e| format!("Zip write failed: {}", e))?;
                count += 1;
            }
        }
    }
    zip.finish().map_err(|e| format!("Zip finalize failed: {}", e))?;
    Ok(count)
}

#[tauri::command]
pub fn cloud_saves_backup(steam_path: String) -> Result<String, String> {
    let src = PathBuf::from(current_folder(&steam_path));
    if !src.is_dir() || !dir_has_files(&src) {
        return Err("No cloud saves to back up yet".into());
    }
    let desktop = dirs::desktop_dir()
        .or_else(dirs::home_dir)
        .ok_or("Could not resolve the desktop folder")?;

    let mut dest = desktop.join("Veil Cloud Saves Backup.zip");
    let mut n = 2;
    while dest.exists() {
        dest = desktop.join(format!("Veil Cloud Saves Backup ({}).zip", n));
        n += 1;
    }

    let count = zip_dir(&src, &dest)?;
    if count == 0 {
        let _ = fs::remove_file(&dest);
        return Err("No save files found to back up".into());
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cloud_saves_import(steam_path: String, zip_path: String) -> Result<u32, String> {
    let dest_root = PathBuf::from(current_folder(&steam_path));
    fs::create_dir_all(&dest_root).map_err(|e| format!("Failed to create folder: {}", e))?;

    let file = fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;

    let mut count = 0u32;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Zip entry error: {}", e))?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dest_root.join(rel.to_path_buf());
        if entry.is_dir() {
            let _ = fs::create_dir_all(&out);
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
        }
        clear_readonly(&out);
        let mut f = fs::File::create(&out).map_err(|e| format!("Failed to write {}: {}", out.display(), e))?;
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("Extract failed: {}", e))?;
        count += 1;
    }

    if count == 0 {
        return Err("That zip didn't contain any save files".into());
    }
    Ok(count)
}
