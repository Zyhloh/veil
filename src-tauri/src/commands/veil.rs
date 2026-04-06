use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use sha2::{Sha256, Digest};
use winreg::enums::*;
use winreg::RegKey;

const BUNDLED_DWMAPI: &[u8] = include_bytes!("../../resources/dwmapi.dll");
const BUNDLED_XINPUT: &[u8] = include_bytes!("../../resources/xinput1_4.dll");
const BUNDLED_PACKCODE: &[u8] = include_bytes!("../../resources/packcode.vdf");
const BUNDLED_VERSION: &[u8] = include_bytes!("../../resources/version");

fn file_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn bundled_dwmapi_hash() -> &'static str {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| file_hash(BUNDLED_DWMAPI))
}
fn bundled_xinput_hash() -> &'static str {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| file_hash(BUNDLED_XINPUT))
}
fn bundled_packcode_hash() -> &'static str {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| file_hash(BUNDLED_PACKCODE))
}
fn bundled_version_hash() -> &'static str {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| file_hash(BUNDLED_VERSION))
}

struct VeilFile {
    path: PathBuf,
    data: &'static [u8],
    expected_hash: &'static str,
}

fn veil_files(steam_path: &str) -> [VeilFile; 4] {
    let steam = Path::new(steam_path);
    let appcache = steam.join("appcache");
    [
        VeilFile { path: steam.join("dwmapi.dll"),    data: BUNDLED_DWMAPI,   expected_hash: bundled_dwmapi_hash() },
        VeilFile { path: steam.join("xinput1_4.dll"), data: BUNDLED_XINPUT,   expected_hash: bundled_xinput_hash() },
        VeilFile { path: appcache.join("packcode.vdf"), data: BUNDLED_PACKCODE, expected_hash: bundled_packcode_hash() },
        VeilFile { path: appcache.join("version"),      data: BUNDLED_VERSION,  expected_hash: bundled_version_hash() },
    ]
}

/// Returns (missing_or_wrong, missing_count, wrong_hash_count)
fn audit_files(files: &[VeilFile]) -> (Vec<&Path>, u32, u32) {
    let mut bad = Vec::new();
    let mut missing = 0u32;
    let mut wrong = 0u32;
    for f in files {
        if !f.path.exists() {
            missing += 1;
            bad.push(f.path.as_path());
            continue;
        }
        match fs::read(&f.path) {
            Ok(d) => {
                if file_hash(&d) != f.expected_hash {
                    wrong += 1;
                    bad.push(f.path.as_path());
                }
            }
            Err(_) => {
                wrong += 1;
                bad.push(f.path.as_path());
            }
        }
    }
    (bad, missing, wrong)
}

fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    fs::write(path, data).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn set_unlock_registry() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey("Software\\Valve\\Steamtools")
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

#[derive(serde::Serialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub missing: u32,
    pub wrong_hash: u32,
    pub steam_running: bool,
}

/// Read-only check. Cheap enough to call on a few-second interval.
#[tauri::command]
pub fn verify_veil_dll(steam_path: String) -> Result<VerifyResult, String> {
    let files = veil_files(&steam_path);
    let (bad, missing, wrong_hash) = audit_files(&files);
    Ok(VerifyResult {
        ok: bad.is_empty(),
        missing,
        wrong_hash,
        steam_running: is_steam_process_running(),
    })
}

#[tauri::command]
pub fn ensure_veil_dll(steam_path: String) -> Result<String, String> {
    let files = veil_files(&steam_path);
    let (bad, _missing, _wrong) = audit_files(&files);

    if bad.is_empty() {
        // Always reassert registry — cheap and self-healing if a user clears it.
        set_unlock_registry()?;
        return Ok("already_installed".to_string());
    }

    // Steam holds locks on dwmapi.dll / xinput1_4.dll while running, so we
    // must stop it before rewriting any of those files.
    let killed_steam = if is_steam_process_running() {
        kill_steam_processes();
        // Give Windows a moment to release file handles.
        for _ in 0..10 {
            if !is_steam_process_running() { break; }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        true
    } else {
        false
    };

    // Rewrite ONLY the files that are missing or wrong, but always re-verify
    // every file's hash before declaring success.
    for f in &files {
        let needs_write = !f.path.exists() || fs::read(&f.path)
            .map(|d| file_hash(&d) != f.expected_hash)
            .unwrap_or(true);
        if needs_write {
            write_file(&f.path, f.data)?;
        }
    }

    // Post-write verification — if anything still doesn't match, fail loudly.
    let (still_bad, _, _) = audit_files(&files);
    if !still_bad.is_empty() {
        return Err(format!(
            "Veil files failed post-write verification: {}",
            still_bad.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
        ));
    }

    set_unlock_registry()?;

    Ok(if killed_steam { "repaired".to_string() } else { "installed".to_string() })
}

#[tauri::command]
pub fn remove_veil_dll(steam_path: String) -> Result<String, String> {
    let files = veil_files(&steam_path);

    let any_present = files.iter().any(|f| f.path.exists());
    if !any_present {
        remove_unlock_registry()?;
        return Ok("not_installed".to_string());
    }

    // Refuse to remove a dwmapi.dll we don't recognise — it might be the
    // user's own / a different mod.
    let dwmapi = &files[0];
    if dwmapi.path.exists() {
        let existing = fs::read(&dwmapi.path).map_err(|e| e.to_string())?;
        if file_hash(&existing) != dwmapi.expected_hash {
            return Ok("not_ours".to_string());
        }
    }

    if is_steam_process_running() {
        kill_steam_processes();
        for _ in 0..10 {
            if !is_steam_process_running() { break; }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    for f in &files {
        if f.path.exists() {
            let _ = fs::remove_file(&f.path);
        }
    }

    remove_unlock_registry()?;

    Ok("removed".to_string())
}

#[tauri::command]
pub fn install_manifest_paths(steam_path: String, paths: Vec<String>) -> Result<InstallResult, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    let depotcache_config = Path::new(&steam_path).join("config").join("depotcache");
    let depotcache_root = Path::new(&steam_path).join("depotcache");

    fs::create_dir_all(&stplugin).map_err(|e| e.to_string())?;
    fs::create_dir_all(&depotcache_config).map_err(|e| e.to_string())?;
    fs::create_dir_all(&depotcache_root).map_err(|e| e.to_string())?;

    let mut lua_count = 0u32;
    let mut manifest_count = 0u32;

    for file_path in &paths {
        let p = Path::new(file_path);
        let lower = p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if lower.ends_with(".zip") {
            let data = fs::read(p).map_err(|e| format!("Failed to read {}: {}", file_path, e))?;
            let reader = std::io::Cursor::new(data);
            let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                if entry.is_dir() { continue; }

                let name = entry.name().to_string();
                let basename = Path::new(&name)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let entry_lower = basename.to_lowercase();

                if entry_lower.ends_with(".lua") {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| e.to_string())?;
                    fs::write(stplugin.join(&basename), &buf).map_err(|e| e.to_string())?;
                    lua_count += 1;
                } else if entry_lower.ends_with(".manifest") {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| e.to_string())?;
                    fs::write(depotcache_config.join(&basename), &buf).map_err(|e| e.to_string())?;
                    fs::write(depotcache_root.join(&basename), &buf).map_err(|e| e.to_string())?;
                    manifest_count += 1;
                }
            }
        } else if lower.ends_with(".lua") {
            let data = fs::read(p).map_err(|e| e.to_string())?;
            let basename = p.file_name().unwrap().to_string_lossy().to_string();
            fs::write(stplugin.join(&basename), &data).map_err(|e| e.to_string())?;
            lua_count += 1;
        } else if lower.ends_with(".manifest") {
            let data = fs::read(p).map_err(|e| e.to_string())?;
            let basename = p.file_name().unwrap().to_string_lossy().to_string();
            fs::write(depotcache_config.join(&basename), &data).map_err(|e| e.to_string())?;
            fs::write(depotcache_root.join(&basename), &data).map_err(|e| e.to_string())?;
            manifest_count += 1;
        }
    }

    Ok(InstallResult { lua_count, manifest_count })
}

#[tauri::command]
pub fn list_installed_games(steam_path: String) -> Result<Vec<InstalledGame>, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    let depotcache_config = Path::new(&steam_path).join("config").join("depotcache");
    let depotcache_root = Path::new(&steam_path).join("depotcache");
    let mut games = Vec::new();

    if !stplugin.exists() {
        return Ok(games);
    }

    let entries = fs::read_dir(&stplugin).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map(|e| e == "lua").unwrap_or(false) {
            let game_id = path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            if !game_id.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }

            let content = fs::read_to_string(&path).unwrap_or_default();

            let re = regex::Regex::new(r#"addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+""#).unwrap();
            let depot_ids: Vec<String> = re.captures_iter(&content)
                .map(|c| c[1].to_string())
                .collect();

            let manifest_count = count_matching_files(&depotcache_config, &depot_ids)
                + count_matching_files(&depotcache_root, &depot_ids);

            games.push(InstalledGame {
                game_id,
                game_name: String::new(),
                manifest_count,
            });
        }
    }

    Ok(games)
}

fn count_matching_files(dir: &Path, depot_ids: &[String]) -> u32 {
    if !dir.exists() { return 0; }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut count = 0u32;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".manifest") {
            for depot_id in depot_ids {
                if name.starts_with(&format!("{}_", depot_id)) {
                    count += 1;
                    break;
                }
            }
        }
    }
    count
}

#[tauri::command]
pub fn uninstall_game(steam_path: String, game_id: String) -> Result<(), String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    let depotcache_config = Path::new(&steam_path).join("config").join("depotcache");
    let depotcache_root = Path::new(&steam_path).join("depotcache");

    remove_matching_files(&stplugin, &game_id)?;
    remove_matching_files(&depotcache_config, &game_id)?;
    remove_matching_files(&depotcache_root, &game_id)?;

    Ok(())
}

fn remove_matching_files(dir: &Path, pattern: &str) -> Result<(), String> {
    if !dir.exists() { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(pattern) {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn is_steam_process_running() -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe"])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("steam.exe"),
        Err(_) => false,
    }
}

fn kill_steam_processes() {
    let _ = Command::new("taskkill").args(["/F", "/IM", "steam.exe"]).output();
    let _ = Command::new("taskkill").args(["/F", "/IM", "steamwebhelper.exe"]).output();
}

#[derive(serde::Serialize)]
pub struct InstallResult {
    pub lua_count: u32,
    pub manifest_count: u32,
}

#[derive(serde::Serialize)]
pub struct InstalledGame {
    pub game_id: String,
    pub game_name: String,
    pub manifest_count: u32,
}
