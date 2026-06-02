use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub steam_path: String,
    pub veil_enabled: bool,
    pub veil_category: bool,
    pub patches_applied: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            steam_path: String::new(),
            veil_enabled: true,
            veil_category: true,
            patches_applied: false,
        }
    }
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

    if config.steam_path.is_empty() {
        if let Some(detected) = crate::commands::steam::detect_steam_path() {
            config.steam_path = detected;
            write_config(&config).ok();
        }
    }

    Ok(config)
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    write_config(&config)
}
