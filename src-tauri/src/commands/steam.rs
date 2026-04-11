use winreg::enums::*;
use winreg::RegKey;
use sysinfo::System;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[tauri::command]
pub fn get_steam_path() -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let key = hklm
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .or_else(|_| hklm.open_subkey("SOFTWARE\\Valve\\Steam"))
        .map_err(|e| format!("Failed to find Steam registry key: {}", e))?;

    let path: String = key
        .get_value("InstallPath")
        .map_err(|e| format!("Failed to read Steam install path: {}", e))?;

    Ok(path)
}

#[tauri::command]
pub fn check_steam_running() -> bool {
    let s = System::new_all();
    s.processes().values().any(|p| {
        p.name()
            .to_string_lossy()
            .to_lowercase()
            .contains("steam.exe")
    })
}

fn kill_all_steam_processes() -> Result<u32, String> {
    let s = System::new_all();
    let mut killed = 0u32;
    let targets = [
        "steam.exe",
        "steamservice.exe",
        "steamwebhelper.exe",
        "steamerrorreporter.exe",
        "steamerrorreporter64.exe",
        "gameoverlayui.exe",
    ];
    for proc in s.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if targets.iter().any(|t| name == *t) {
            if proc.kill() {
                killed += 1;
            }
        }
    }

    #[cfg(windows)]
    {
        for t in targets.iter() {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", t, "/T"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(600));
    Ok(killed)
}

fn steam_exe_path() -> Result<PathBuf, String> {
    let install = get_steam_path()?;
    let path = PathBuf::from(install).join("steam.exe");
    if !path.exists() {
        return Err(format!("steam.exe not found at {}", path.display()));
    }
    Ok(path)
}

fn spawn_steam() -> Result<(), String> {
    let exe = steam_exe_path()?;
    let mut cmd = Command::new(&exe);
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
pub async fn kill_steam() -> Result<u32, String> {
    kill_all_steam_processes()
}

#[tauri::command]
pub async fn restart_steam() -> Result<(), String> {
    let _ = kill_all_steam_processes()?;
    spawn_steam()
}

#[tauri::command]
pub async fn shutdown_steam_for_patching() -> Result<bool, String> {
    use tokio::time::{sleep, Duration};

    let was_running = check_steam_running();
    if !was_running {
        return Ok(false);
    }

    if let Ok(exe) = steam_exe_path() {
        let mut cmd = Command::new(&exe);
        cmd.arg("-shutdown");
        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
        }
        let _ = cmd.spawn();
    }

    for _ in 0..40 {
        sleep(Duration::from_millis(250)).await;
        if !check_steam_running() {
            sleep(Duration::from_millis(400)).await;
            return Ok(true);
        }
    }

    let _ = kill_all_steam_processes();

    for _ in 0..20 {
        sleep(Duration::from_millis(250)).await;
        if !check_steam_running() {
            sleep(Duration::from_millis(500)).await;
            return Ok(true);
        }
    }

    Err("Steam did not exit after shutdown + force-kill".to_string())
}
