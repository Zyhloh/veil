use std::fs;
use std::path::Path;
use std::process::Command;
use sha2::{Sha256, Digest};

const BUNDLED_DLL: &[u8] = include_bytes!("../../resources/dwmapi.dll");

fn dll_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
pub fn ensure_veil_dll(steam_path: String) -> Result<String, String> {
    let dll_dest = Path::new(&steam_path).join("dwmapi.dll");
    let expected_hash = dll_hash(BUNDLED_DLL);

    if dll_dest.exists() {
        let existing = fs::read(&dll_dest).map_err(|e| e.to_string())?;
        if dll_hash(&existing) == expected_hash {
            return Ok("already_installed".to_string());
        }
    }

    if is_steam_process_running() {
        kill_steam_processes();
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    fs::write(&dll_dest, BUNDLED_DLL).map_err(|e| format!("Failed to write dwmapi.dll: {}", e))?;

    Ok("installed".to_string())
}

#[tauri::command]
pub fn remove_veil_dll(steam_path: String) -> Result<String, String> {
    let dll_dest = Path::new(&steam_path).join("dwmapi.dll");

    if !dll_dest.exists() {
        return Ok("not_installed".to_string());
    }

    let expected_hash = dll_hash(BUNDLED_DLL);
    let existing = fs::read(&dll_dest).map_err(|e| e.to_string())?;
    if dll_hash(&existing) != expected_hash {
        return Ok("not_ours".to_string());
    }

    if is_steam_process_running() {
        kill_steam_processes();
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    fs::remove_file(&dll_dest).map_err(|e| format!("Failed to remove dwmapi.dll: {}", e))?;

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
