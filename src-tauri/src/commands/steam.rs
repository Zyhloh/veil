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

// Kill every steam-related process. Best-effort: ignores per-process failures
// and waits briefly for the OS to release handles before returning.
fn kill_all_steam_processes() -> Result<u32, String> {
    let s = System::new_all();
    let mut killed = 0u32;
    // Names we want gone — Steam itself, the service, web helpers, overlay,
    // crash handler, etc.
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

    // Belt-and-suspenders: hit anything still alive with taskkill /F.
    #[cfg(windows)]
    {
        for t in targets.iter() {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", t, "/T"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }

    // Give the OS a moment to release handles so a subsequent start works.
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
