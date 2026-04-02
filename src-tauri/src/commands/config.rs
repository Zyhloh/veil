use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub steam_path: String,
    pub theme: String,
    pub auto_restart_steam: bool,
    pub export_path: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        let export_path = dirs::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Veil Exports")
            .to_string_lossy()
            .to_string();

        Self {
            steam_path: String::new(),
            theme: "dark".to_string(),
            auto_restart_steam: true,
            export_path,
        }
    }
}

fn config_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    let path = config_path();
    if path.exists() {
        let data = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse config: {}", e))
    } else {
        let config = AppConfig::default();
        save_app_config(config.clone())?;
        Ok(config)
    }
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    let path = config_path();
    let data = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, data)
        .map_err(|e| format!("Failed to write config: {}", e))
}
