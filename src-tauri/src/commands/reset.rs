use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use sysinfo::System;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

const STEAM_PROCESS_NAMES: &[&str] = &[
    "steam.exe",
    "steamservice.exe",
    "steamwebhelper.exe",
    "steamerrorreporter.exe",
    "steamerrorreporter64.exe",
    "gameoverlayui.exe",
    "writeminidump.exe",
];

const ROOT_PRESERVE: &[&str] = &[
    "steamapps",
    "userdata",
    "config",
    "depotcache",
    "steam.exe",
];

#[derive(Serialize, Default)]
pub struct ResetResult {
    pub deleted_entries: u32,
    pub failed_entries: u32,
    pub freed_bytes: u64,
    pub steam_started: bool,
    pub failures: Vec<String>,
}

fn steam_running() -> bool {
    let s = System::new_all();
    s.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        STEAM_PROCESS_NAMES.iter().any(|t| name == *t)
    })
}

fn kill_steam_blocking() -> Result<(), String> {
    let s = System::new_all();
    for proc in s.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if STEAM_PROCESS_NAMES.iter().any(|t| name == *t) {
            let _ = proc.kill();
        }
    }

    #[cfg(windows)]
    {
        for t in STEAM_PROCESS_NAMES {
            let mut cmd = Command::new("taskkill");
            cmd.args(["/F", "/IM", t, "/T"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
            let _ = cmd.status();
        }
    }

    for _ in 0..40 {
        if !steam_running() {
            std::thread::sleep(Duration::from_millis(400));
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    Err("Steam processes did not exit after kill".to_string())
}

fn should_preserve_root(name: &str) -> bool {
    let lower = name.to_lowercase();
    if ROOT_PRESERVE.iter().any(|p| *p == lower) {
        return true;
    }
    if lower.starts_with("ssfn") {
        return true;
    }
    false
}

fn clear_readonly_recursive(path: &Path) {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.permissions().readonly() {
            let mut p = meta.permissions();
            p.set_readonly(false);
            let _ = fs::set_permissions(path, p);
        }
        if meta.is_dir() {
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    clear_readonly_recursive(&entry.path());
                }
            }
        }
    }
}

fn delete_with_retry(path: &Path) -> Result<u64, String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("stat {}: {}", path.display(), e))?;

    let size = if meta.is_dir() {
        dir_size(path)
    } else {
        meta.len()
    };

    clear_readonly_recursive(path);

    let is_dir = meta.is_dir();
    let mut last_err: Option<String> = None;

    for attempt in 0u64..6 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(400 + attempt * 200));
            clear_readonly_recursive(path);
        }

        let res = if is_dir {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };

        match res {
            Ok(()) => return Ok(size),
            Err(e) => last_err = Some(e.to_string()),
        }
    }

    Err(last_err.unwrap_or_else(|| "unknown delete failure".to_string()))
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        match fs::symlink_metadata(&p) {
            Ok(m) if m.is_file() => total += m.len(),
            Ok(m) if m.is_dir() => total += dir_size(&p),
            _ => {}
        }
    }
    total
}

fn spawn_steam(steam_path: &Path) -> Result<(), String> {
    let exe = steam_path.join("steam.exe");
    if !exe.exists() {
        return Err(format!("steam.exe not found at {}", exe.display()));
    }
    let mut cmd = Command::new(&exe);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to start Steam: {}", e))
}

#[tauri::command]
pub async fn reset_steam_install(steam_path: String) -> Result<ResetResult, String> {
    let sp = PathBuf::from(&steam_path);
    if !sp.exists() {
        return Err(format!("Steam path does not exist: {}", steam_path));
    }
    if !sp.join("steam.exe").exists() {
        return Err(format!(
            "steam.exe not found at {} — refusing to reset (path may be wrong)",
            sp.display()
        ));
    }

    let _ = super::config::set_patches_applied(false);

    if steam_running() {
        kill_steam_blocking()?;
    }

    let mut result = ResetResult::default();

    let entries = fs::read_dir(&sp)
        .map_err(|e| format!("read steam dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if should_preserve_root(&name) {
            continue;
        }

        match delete_with_retry(&path) {
            Ok(size) => {
                result.deleted_entries += 1;
                result.freed_bytes += size;
            }
            Err(e) => {
                result.failed_entries += 1;
                let display = format!("{}: {}", name, e);
                if result.failures.len() < 20 {
                    result.failures.push(display);
                }
            }
        }
    }

    match spawn_steam(&sp) {
        Ok(()) => result.steam_started = true,
        Err(e) => {
            if result.failures.len() < 20 {
                result.failures.push(format!("launch steam: {}", e));
            }
        }
    }

    Ok(result)
}
