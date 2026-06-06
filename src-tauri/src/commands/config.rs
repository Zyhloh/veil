use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub steam_path: String,
    pub dump_path: String,
    pub veil_enabled: bool,
    pub veil_category: bool,
    pub patches_applied: bool,
    pub cloud_saves_enabled: bool,
    pub cloud_saves_log: bool,
    pub cloud_saves_steam_ver: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            steam_path: String::new(),
            dump_path: String::new(),
            veil_enabled: true,
            veil_category: true,
            patches_applied: false,
            cloud_saves_enabled: false,
            cloud_saves_log: false,
            cloud_saves_steam_ver: String::new(),
        }
    }
}

const DUMP_DIR_NAME: &str = "Veil Dumps";

/// A directory is usable if it already exists, or if its parent exists and we can
/// create it. The parent check is deliberate: a path whose base is gone (e.g. a
/// Documents folder that was relocated to another drive) is rejected rather than
/// resurrected, so we never write to or display a dead location.
fn usable_dir(path: &Path) -> bool {
    if path.is_dir() {
        return true;
    }
    matches!(path.parent(), Some(parent) if parent.is_dir()) && fs::create_dir_all(path).is_ok()
}

/// Resolves the dump base directory to one that is guaranteed to exist. Tries the
/// preferred (configured) path first, then Documents, then %user%, then %temp%,
/// creating the folder where needed. Falls back to the temp dir as a last resort.
fn resolve_dump_dir(preferred: Option<PathBuf>) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = preferred.filter(|p| !p.as_os_str().is_empty()) {
        candidates.push(p);
    }
    if let Some(docs) = dirs::document_dir() {
        candidates.push(docs.join(DUMP_DIR_NAME));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(DUMP_DIR_NAME));
    }
    candidates.push(std::env::temp_dir().join(DUMP_DIR_NAME));

    candidates
        .into_iter()
        .find(|c| usable_dir(c))
        .unwrap_or_else(std::env::temp_dir)
}

pub fn dump_base_dir() -> PathBuf {
    let configured = get_app_config()
        .ok()
        .filter(|c| !c.dump_path.is_empty())
        .map(|c| PathBuf::from(c.dump_path));
    resolve_dump_dir(configured)
}

#[tauri::command]
pub fn resolve_dump_path() -> String {
    dump_base_dir().to_string_lossy().to_string()
}

pub fn patches_applied() -> bool {
    get_app_config().map(|c| c.patches_applied).unwrap_or(false)
}

pub fn set_patches_applied(v: bool) -> Result<(), String> {
    let mut cfg = get_app_config().unwrap_or_default();
    cfg.patches_applied = v;
    write_config(&cfg)
}

fn config_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn write_config(config: &AppConfig) -> Result<(), String> {
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    let path = config_path();
    let mut config = if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppConfig::default()
    };

    let mut dirty = false;

    // Drop a stored dump path that no longer resolves to a real, creatable location
    // (e.g. a relocated Documents folder) so it falls back to the default and the UI
    // never shows or uses a dead path. A path the user picked that still works is kept.
    if !config.dump_path.is_empty() && !usable_dir(Path::new(&config.dump_path)) {
        config.dump_path = String::new();
        dirty = true;
    }

    if config.steam_path.is_empty() {
        if let Some(detected) = crate::commands::steam::detect_steam_path() {
            config.steam_path = detected;
            dirty = true;
        }
    }

    if dirty {
        write_config(&config).ok();
    }

    Ok(config)
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    write_config(&config)
}
