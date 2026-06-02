use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use sysinfo::System;
use winreg::enums::*;
use winreg::RegKey;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const XINPUT_URL: &str = "https://app.projectveil.cc/dll/xinput1_4.dll";
const DWMAPI_URL: &str = "https://app.projectveil.cc/dll/dwmapi.dll";
const HASHES_URL: &str = "https://app.projectveil.cc/dll/hashes";

const BUNDLED_PACKCODE: &[u8] = include_bytes!("../../resources/packcode.vdf");
const BUNDLED_VERSION: &[u8] = include_bytes!("../../resources/version");
const BUNDLED_PAYLOAD: &[u8] = include_bytes!("../../resources/payload.cache");

struct DllTarget {
    name: &'static str,
    path: PathBuf,
    url: &'static str,
}

struct BundledFile {
    path: PathBuf,
    data: &'static [u8],
}

fn dll_targets(steam_path: &str) -> [DllTarget; 2] {
    let steam = Path::new(steam_path);
    [
        DllTarget { name: "dwmapi.dll", path: steam.join("dwmapi.dll"), url: DWMAPI_URL },
        DllTarget { name: "xinput1_4.dll", path: steam.join("xinput1_4.dll"), url: XINPUT_URL },
    ]
}

fn bundled_files(steam_path: &str) -> [BundledFile; 2] {
    let appcache = Path::new(steam_path).join("appcache");
    [
        BundledFile { path: appcache.join("packcode.vdf"), data: BUNDLED_PACKCODE },
        BundledFile { path: appcache.join("version"), data: BUNDLED_VERSION },
    ]
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, data);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

async fn fetch_remote_hashes() -> Option<HashMap<String, String>> {
    let client = http_client().ok()?;
    let resp = client.get(HASHES_URL).send().await.ok()?;
    let map: HashMap<String, String> = resp.json().await.ok()?;
    Some(map.into_iter().map(|(k, v)| (k, v.to_lowercase())).collect())
}

fn file_sha256(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(sha256_hex(&bytes))
}

fn audit_dlls(targets: &[DllTarget], remote: Option<&HashMap<String, String>>) -> (Vec<usize>, u32, u32) {
    let mut bad = Vec::new();
    let mut missing = 0u32;
    let mut mismatched = 0u32;
    for (i, t) in targets.iter().enumerate() {
        if !t.path.exists() {
            missing += 1;
            bad.push(i);
            continue;
        }
        if let Some(hashes) = remote {
            if let Some(expected) = hashes.get(t.name) {
                match file_sha256(&t.path) {
                    Some(actual) if actual == *expected => {}
                    _ => {
                        mismatched += 1;
                        bad.push(i);
                    }
                }
            }
        }
    }
    (bad, missing, mismatched)
}

async fn download_dll(target: &DllTarget) -> Result<Vec<u8>, String> {
    let client = http_client()?;
    let data = client
        .get(target.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Failed to download {}: {}", target.name, e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {}: {}", target.name, e))?
        .to_vec();
    if data.is_empty() {
        return Err(format!("{}: downloaded empty file", target.name));
    }
    Ok(data)
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    clear_readonly(path);
    match fs::write(path, data) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = fs::remove_file(path);
            fs::write(path, data).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
        }
    }
}

fn deploy_payload_cache(steam_path: &str) -> Result<bool, String> {
    let sp = Path::new(steam_path);
    if super::patcher::find_cache_path(sp).is_some() {
        return Ok(false);
    }
    let cache_dir = sp.join("appcache").join("httpcache").join("3b");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
    let fp = super::patcher::compute_fingerprint();
    write_file(&cache_dir.join(&fp), BUNDLED_PAYLOAD)?;
    Ok(true)
}

fn set_unlock_registry() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Valve\\Steamtools")
        .map_err(|e| format!("Failed to create registry key: {}", e))?;
    key.set_value("ActivateUnlockMode", &"true")
        .map_err(|e| format!("Failed to set ActivateUnlockMode: {}", e))?;
    Ok(())
}

fn remove_unlock_registry() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all("Software\\Valve\\Steamtools");
    Ok(())
}

fn is_steam_running() -> bool {
    let s = System::new_all();
    s.processes()
        .values()
        .any(|p| p.name().to_string_lossy().to_lowercase().contains("steam.exe"))
}

fn kill_steam_processes() {
    let s = System::new_all();
    for proc in s.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if matches!(name.as_str(), "steam.exe" | "steamwebhelper.exe" | "steamservice.exe") {
            let _ = proc.kill();
        }
    }
    #[cfg(windows)]
    for t in ["steam.exe", "steamwebhelper.exe"] {
        let _ = Command::new("taskkill").args(["/F", "/IM", t]).creation_flags(CREATE_NO_WINDOW).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

fn wait_for_steam_exit() {
    for _ in 0..10 {
        if !is_steam_running() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    std::thread::sleep(std::time::Duration::from_millis(500));
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub missing: u32,
    pub stale: u32,
    pub steam_running: bool,
}

#[tauri::command]
pub async fn verify_veil_dll(steam_path: String) -> Result<VerifyResult, String> {
    if super::config::patches_applied() {
        return Ok(VerifyResult { ok: true, missing: 0, stale: 0, steam_running: is_steam_running() });
    }
    let targets = dll_targets(&steam_path);
    let remote = fetch_remote_hashes().await;
    let (bad, missing, mismatched) = audit_dlls(&targets, remote.as_ref());
    Ok(VerifyResult {
        ok: bad.is_empty(),
        missing,
        stale: mismatched,
        steam_running: is_steam_running(),
    })
}

#[tauri::command]
pub async fn ensure_veil_dll(steam_path: String) -> Result<String, String> {
    let targets = dll_targets(&steam_path);
    let bundled = bundled_files(&steam_path);

    let remote = fetch_remote_hashes().await;
    let (bad_indices, _, _) = audit_dlls(&targets, remote.as_ref());

    let appcache_missing: Vec<&BundledFile> = bundled.iter().filter(|f| !f.path.exists()).collect();
    let payload_deployed = deploy_payload_cache(&steam_path).unwrap_or(false);

    if bad_indices.is_empty() && appcache_missing.is_empty() {
        set_unlock_registry()?;
        return Ok(if payload_deployed { "installed" } else { "already_installed" }.to_string());
    }

    let killed_steam = if !bad_indices.is_empty() && is_steam_running() {
        kill_steam_processes();
        wait_for_steam_exit();
        true
    } else {
        false
    };

    for i in &bad_indices {
        let t = &targets[*i];
        let data = download_dll(t).await?;
        if let Some(hashes) = remote.as_ref() {
            if let Some(expected) = hashes.get(t.name) {
                if !sha256_hex(&data).eq_ignore_ascii_case(expected) {
                    return Err(format!("{}: hash mismatch after download", t.name));
                }
            }
        }
        write_file(&t.path, &data)?;
    }

    for f in appcache_missing {
        write_file(&f.path, f.data)?;
    }

    if !payload_deployed {
        let _ = deploy_payload_cache(&steam_path);
    }

    set_unlock_registry()?;

    Ok(if killed_steam {
        "repaired"
    } else if !bad_indices.is_empty() {
        "installed"
    } else {
        "already_installed"
    }
    .to_string())
}

#[tauri::command]
pub fn remove_veil_dll(steam_path: String) -> Result<String, String> {
    let _ = super::config::set_patches_applied(false);
    let targets = dll_targets(&steam_path);
    let bundled = bundled_files(&steam_path);

    let all_paths: Vec<PathBuf> = targets
        .iter()
        .map(|t| t.path.clone())
        .chain(bundled.iter().map(|f| f.path.clone()))
        .collect();

    if !all_paths.iter().any(|p| p.exists()) {
        remove_unlock_registry()?;
        return Ok("not_installed".to_string());
    }

    if is_steam_running() {
        kill_steam_processes();
        wait_for_steam_exit();
    }

    for p in &all_paths {
        if p.exists() {
            clear_readonly(p);
            let _ = fs::remove_file(p);
        }
    }

    remove_unlock_registry()?;
    Ok("removed".to_string())
}
