use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter};

fn parse_depot_ids_from_lua(lua_content: &str) -> Vec<String> {
    let re = regex::Regex::new(r#"addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+""#).unwrap();
    let mut ids: Vec<String> = re.captures_iter(lua_content)
        .map(|c| c[1].to_string())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

fn get_manifest_gid(api_json: &serde_json::Value, app_id: &str, depot_id: &str) -> Option<String> {
    api_json
        .get("data")?
        .get(app_id)?
        .get("depots")?
        .get(depot_id)?
        .get("manifests")?
        .get("public")?
        .get("gid")?
        .as_str()
        .map(|s| s.to_string())
}

fn emit_progress(app: &AppHandle, message: &str) {
    let _ = app.emit("fix-progress", message.to_string());
}

async fn fix_app_internal(
    app: &AppHandle,
    steam_path: &str,
    app_id: &str,
    app_index: usize,
    app_total: usize,
) -> Result<FixResult, String> {
    let stplugin = Path::new(steam_path).join("config").join("stplug-in");
    let depotcache_config = Path::new(steam_path).join("config").join("depotcache");
    let depotcache_root = Path::new(steam_path).join("depotcache");

    fs::create_dir_all(&depotcache_config).map_err(|e| e.to_string())?;
    fs::create_dir_all(&depotcache_root).map_err(|e| e.to_string())?;

    let lua_path = stplugin.join(format!("{}.lua", app_id));
    if !lua_path.exists() {
        return Err(format!("No lua file found for app {}", app_id));
    }

    let lua_content = fs::read_to_string(&lua_path).map_err(|e| e.to_string())?;
    let depot_ids = parse_depot_ids_from_lua(&lua_content);

    if depot_ids.is_empty() {
        return Err("No depot IDs found in lua file".to_string());
    }

    emit_progress(app, &format!("Fetching info for app {} ({}/{})", app_id, app_index, app_total));

    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let api_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let status = api_json.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if status != "success" {
        return Err("SteamCMD API returned non-success status".to_string());
    }

    let client = reqwest::Client::new();
    let mut downloaded = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;

    for (i, depot_id) in depot_ids.iter().enumerate() {
        let manifest_id = match get_manifest_gid(&api_json, app_id, depot_id) {
            Some(id) => id,
            None => {
                failed += 1;
                continue;
            }
        };

        let filename = format!("{}_{}.manifest", depot_id, manifest_id);
        let dest_config = depotcache_config.join(&filename);
        let dest_root = depotcache_root.join(&filename);

        if dest_root.exists() {
            let size = fs::metadata(&dest_root).map(|m| m.len()).unwrap_or(0);
            if size > 0 {
                if !dest_config.exists() {
                    let _ = fs::copy(&dest_root, &dest_config);
                }
                skipped += 1;
                continue;
            }
        }

        emit_progress(app, &format!(
            "Downloading depot {}/{} for app {} ({}/{})",
            i + 1, depot_ids.len(), app_id, app_index, app_total
        ));

        let github_url = format!(
            "https://raw.githubusercontent.com/qwe213312/k25FCdfEOoEJ42S6/main/{}",
            filename
        );

        match client.get(&github_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.bytes().await {
                    Ok(bytes) if !bytes.is_empty() => {
                        fs::write(&dest_config, &bytes).map_err(|e| e.to_string())?;
                        fs::write(&dest_root, &bytes).map_err(|e| e.to_string())?;
                        downloaded += 1;
                    }
                    _ => { failed += 1; }
                }
            }
            _ => { failed += 1; }
        }
    }

    Ok(FixResult { downloaded, skipped, failed })
}

#[tauri::command]
pub async fn fix_manifests_for_app(steam_path: String, app_id: String, app: AppHandle) -> Result<FixResult, String> {
    fix_app_internal(&app, &steam_path, &app_id, 1, 1).await
}

#[tauri::command]
pub async fn fix_all_manifests(steam_path: String, app: AppHandle) -> Result<FixResult, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");

    if !stplugin.exists() {
        return Ok(FixResult { downloaded: 0, skipped: 0, failed: 0 });
    }

    emit_progress(&app, "Checking for apps to fix...");

    let entries = fs::read_dir(&stplugin).map_err(|e| e.to_string())?;
    let mut app_ids = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map(|e| e == "lua").unwrap_or(false) {
            if let Some(stem) = path.file_stem() {
                let id = stem.to_string_lossy().to_string();
                if id.chars().all(|c| c.is_ascii_digit()) {
                    app_ids.push(id);
                }
            }
        }
    }

    if app_ids.is_empty() {
        return Ok(FixResult { downloaded: 0, skipped: 0, failed: 0 });
    }

    emit_progress(&app, &format!("Found {} app(s) to check", app_ids.len()));

    let mut total = FixResult { downloaded: 0, skipped: 0, failed: 0 };

    for (i, app_id) in app_ids.iter().enumerate() {
        match fix_app_internal(&app, &steam_path, app_id, i + 1, app_ids.len()).await {
            Ok(r) => {
                total.downloaded += r.downloaded;
                total.skipped += r.skipped;
                total.failed += r.failed;
            }
            Err(_) => { total.failed += 1; }
        }
    }

    Ok(total)
}

#[derive(serde::Serialize, Clone)]
pub struct FixResult {
    pub downloaded: u32,
    pub skipped: u32,
    pub failed: u32,
}
