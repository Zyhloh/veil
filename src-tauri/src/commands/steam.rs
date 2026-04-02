use winreg::enums::*;
use winreg::RegKey;
use sysinfo::System;

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
