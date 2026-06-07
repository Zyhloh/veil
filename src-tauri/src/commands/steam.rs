use std::path::PathBuf;
use std::process::{Command, Stdio};
use sysinfo::System;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[cfg(windows)]
pub fn detect_steam_path() -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let keys = [
        hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam"),
        hklm.open_subkey("SOFTWARE\\Valve\\Steam"),
        hkcu.open_subkey("SOFTWARE\\Valve\\Steam"),
    ];

    for key in keys.into_iter().flatten() {
        if let Ok(path) = key.get_value::<String, _>("InstallPath") {
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    for guess in ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"] {
        if std::path::Path::new(guess).exists() {
            return Some(guess.to_string());
        }
    }

    None
}

#[cfg(not(windows))]
pub fn detect_steam_path() -> Option<String> {
    None
}

#[tauri::command]
pub fn get_steam_path() -> Result<String, String> {
    detect_steam_path().ok_or_else(|| "Could not detect Steam installation path".to_string())
}

#[tauri::command]
pub fn check_steam_running() -> bool {
    let system = System::new_all();
    system
        .processes()
        .values()
        .any(|p| p.name().to_string_lossy().to_lowercase().contains("steam.exe"))
}

fn kill_all_steam() -> u32 {
    let system = System::new_all();
    let targets = [
        "steam.exe",
        "steamservice.exe",
        "steamwebhelper.exe",
        "steamerrorreporter.exe",
        "gameoverlayui.exe",
    ];

    let mut killed = 0u32;
    for proc in system.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if targets.iter().any(|t| name == *t) && proc.kill() {
            killed += 1;
        }
    }

    #[cfg(windows)]
    for target in targets.iter() {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", target, "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    std::thread::sleep(std::time::Duration::from_millis(600));
    killed
}

fn steam_exe() -> Result<PathBuf, String> {
    let install = detect_steam_path().ok_or_else(|| "Steam not found".to_string())?;
    let path = PathBuf::from(install).join("steam.exe");
    if !path.exists() {
        return Err("steam.exe not found".to_string());
    }
    Ok(path)
}

// Steam rewrites its collections on exit, so the Veil collection only sticks
// when written while Steam is down. Every Veil-initiated launch goes through
// here with Steam stopped, so sync the collection right before starting it.
fn sync_veil_category_if_enabled() {
    if let Ok(cfg) = super::config::get_app_config() {
        if cfg.veil_category && !cfg.steam_path.is_empty() {
            let _ = super::categories::sync_veil_category(cfg.steam_path);
        }
    }
}

fn spawn_steam() -> Result<(), String> {
    sync_veil_category_if_enabled();
    let exe = steam_exe()?;
    let mut cmd = Command::new(&exe);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to start Steam: {}", e))
}

#[tauri::command]
pub async fn start_steam() -> Result<(), String> {
    if check_steam_running() {
        return Ok(());
    }
    spawn_steam()
}

#[tauri::command]
pub async fn stop_steam() -> Result<(), String> {
    if !check_steam_running() {
        return Ok(());
    }
    let exe = steam_exe()?;
    let mut cmd = Command::new(&exe);
    cmd.arg("-shutdown");
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to stop Steam: {}", e))
}

#[tauri::command]
pub async fn kill_steam() -> Result<u32, String> {
    Ok(kill_all_steam())
}

#[tauri::command]
pub async fn launch_game_steam(app_id: u32) -> Result<(), String> {
    let exe = steam_exe()?;
    let mut cmd = Command::new(&exe);
    cmd.arg("-applaunch").arg(app_id.to_string());
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch game: {}", e))
}

#[tauri::command]
pub async fn restart_steam() -> Result<(), String> {
    kill_all_steam();
    spawn_steam()
}
