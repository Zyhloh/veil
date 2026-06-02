use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use super::catalog::{lua_from_zip, MH_OWNER, MH_REPO, SKY_BASE};

const CHECK_INTERVAL_SECS: u64 = 60 * 60 * 24;

#[derive(Serialize, Clone, Default)]
pub struct FixResult {
    pub apps_checked: u32,
    pub updated: u32,
    pub skipped: u32,
    pub failed: u32,
}

#[derive(Serialize, Deserialize, Default)]
struct EtagCache {
    last_check: u64,
    etags: BTreeMap<String, String>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_path() -> PathBuf {
    let dir = dirs::cache_dir().unwrap_or_else(|| PathBuf::from(".")).join("Veil");
    let _ = fs::create_dir_all(&dir);
    dir.join("lua_etags.json")
}

fn load_cache() -> EtagCache {
    fs::read(cache_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_cache(cache: &EtagCache) {
    if let Ok(bytes) = serde_json::to_vec(cache) {
        let _ = fs::write(cache_path(), bytes);
    }
}

fn contains_appid(content: &str, app_id: &str) -> bool {
    regex::Regex::new(&format!(r"(?m)^\s*addappid\s*\(\s*{}\b", app_id))
        .map(|re| re.is_match(content))
        .unwrap_or(false)
}

fn preserve_appends(old: &str, new: &str) -> String {
    let line_re = match regex::Regex::new(r"(?m)^(\s*addappid\s*\(\s*(\d+)\s*\)\s*--.*)$") {
        Ok(re) => re,
        Err(_) => return new.to_string(),
    };
    let mut result = new.to_string();
    for cap in line_re.captures_iter(old) {
        let line = cap[1].trim();
        let id = &cap[2];
        if !contains_appid(&result, id) {
            if !result.is_empty() && !result.ends_with('\n') {
                result.push('\n');
            }
            result.push_str(line);
            result.push('\n');
        }
    }
    result
}

fn parse_depots(lua: &str) -> Vec<(String, Option<String>)> {
    let depot_re =
        regex::Regex::new(r#"addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+""#).unwrap();
    let manifest_re = regex::Regex::new(r#"setManifestid\s*\(\s*(\d+)\s*,\s*"?(\d+)"?"#).unwrap();

    let mut gids: BTreeMap<String, String> = BTreeMap::new();
    for cap in manifest_re.captures_iter(lua) {
        gids.insert(cap[1].to_string(), cap[2].to_string());
    }

    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for cap in depot_re.captures_iter(lua) {
        let depot = cap[1].to_string();
        if seen.insert(depot.clone()) {
            let gid = gids.get(&depot).cloned();
            out.push((depot, gid));
        }
    }
    out
}

fn present_depots(dirs: &[&Path]) -> BTreeSet<String> {
    let mut set = BTreeSet::new();
    for dir in dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !name.ends_with(".manifest") {
                    continue;
                }
                if let Some(depot) = name.split('_').next() {
                    if !depot.is_empty() && depot.chars().all(|c| c.is_ascii_digit()) {
                        if entry.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                            set.insert(depot.to_string());
                        }
                    }
                }
            }
        }
    }
    set
}

async fn api_gids(client: &reqwest::Client, app_id: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    let Ok(resp) = client.get(&url).send().await else {
        return map;
    };
    let Ok(json) = resp.json::<Value>().await else {
        return map;
    };
    if let Some(depots) = json["data"][app_id]["depots"].as_object() {
        for (depot, info) in depots {
            if let Some(gid) = info["manifests"]["public"]["gid"].as_str() {
                map.insert(depot.clone(), gid.to_string());
            }
        }
    }
    map
}

async fn backfill_manifests(
    client: &reqwest::Client,
    steam_path: &str,
    app_id: &str,
    present: &BTreeSet<String>,
) -> (u32, u32) {
    let lua_path = Path::new(steam_path)
        .join("config")
        .join("stplug-in")
        .join(format!("{}.lua", app_id));
    let lua = match fs::read_to_string(&lua_path) {
        Ok(c) => c,
        Err(_) => return (0, 0),
    };

    let mut missing: Vec<(String, Option<String>)> = parse_depots(&lua)
        .into_iter()
        .filter(|(d, _)| !present.contains(d))
        .collect();
    if missing.is_empty() {
        return (0, 0);
    }

    if missing.iter().any(|(_, gid)| gid.is_none()) {
        let api = api_gids(client, app_id).await;
        for (depot, gid) in missing.iter_mut() {
            if gid.is_none() {
                *gid = api.get(depot).cloned();
            }
        }
    }

    let depot_a = Path::new(steam_path).join("config").join("depotcache");
    let depot_b = Path::new(steam_path).join("depotcache");
    if fs::create_dir_all(&depot_a).is_err() || fs::create_dir_all(&depot_b).is_err() {
        return (0, missing.len() as u32);
    }

    let (mut downloaded, mut failed) = (0u32, 0u32);
    for (depot, gid) in &missing {
        let Some(gid) = gid else {
            failed += 1;
            continue;
        };
        let filename = format!("{}_{}.manifest", depot, gid);
        let url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            MH_OWNER, MH_REPO, app_id, filename
        );
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                Ok(bytes) if !bytes.is_empty() => {
                    let a = fs::write(depot_a.join(&filename), &bytes).is_ok();
                    let b = fs::write(depot_b.join(&filename), &bytes).is_ok();
                    if a && b {
                        downloaded += 1;
                    } else {
                        failed += 1;
                    }
                }
                _ => failed += 1,
            },
            _ => failed += 1,
        }
    }
    (downloaded, failed)
}

#[tauri::command]
pub async fn fix_library_manifests(
    app: AppHandle,
    steam_path: String,
    force: bool,
) -> Result<FixResult, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    if !stplugin.exists() {
        return Ok(FixResult::default());
    }

    let mut cache = load_cache();
    let now = now_secs();
    if !force && now.saturating_sub(cache.last_check) < CHECK_INTERVAL_SECS {
        return Ok(FixResult::default());
    }

    let mut app_ids: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&stplugin) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("lua") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if !stem.is_empty() && stem.chars().all(|c| c.is_ascii_digit()) {
                    app_ids.push(stem.to_string());
                }
            }
        }
    }
    if app_ids.is_empty() {
        return Ok(FixResult::default());
    }

    let client = http_client()?;
    if client.get("https://raw.githubusercontent.com/").send().await.is_err() {
        return Ok(FixResult::default());
    }

    let depot_a = Path::new(&steam_path).join("config").join("depotcache");
    let depot_b = Path::new(&steam_path).join("depotcache");
    let present = present_depots(&[depot_a.as_path(), depot_b.as_path()]);

    let total = app_ids.len();
    let mut result = FixResult {
        apps_checked: total as u32,
        ..FixResult::default()
    };

    for (i, app_id) in app_ids.iter().enumerate() {
        let _ = app.emit("fix-progress", format!("Checking for updates {}/{}", i + 1, total));

        let url = format!("{}/{}.zip", SKY_BASE, app_id);
        let mut req = client.get(&url);
        if let Some(etag) = cache.etags.get(app_id) {
            req = req.header("If-None-Match", etag.clone());
        }

        match req.send().await {
            Ok(resp) if resp.status() == reqwest::StatusCode::NOT_MODIFIED => {
                result.skipped += 1;
            }
            Ok(resp) if resp.status().is_success() => {
                let etag = resp
                    .headers()
                    .get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let bytes = match resp.bytes().await {
                    Ok(b) => b,
                    Err(_) => {
                        result.failed += 1;
                        continue;
                    }
                };
                match lua_from_zip(bytes.as_ref()) {
                    Some(new_lua) => {
                        let lua_path = stplugin.join(format!("{}.lua", app_id));
                        let old = fs::read_to_string(&lua_path).unwrap_or_default();
                        let merged = preserve_appends(&old, &new_lua);
                        if merged.trim() == old.trim() {
                            result.skipped += 1;
                        } else {
                            let tmp = lua_path.with_extension("lua.tmp");
                            if fs::write(&tmp, &merged).is_ok() && fs::rename(&tmp, &lua_path).is_ok() {
                                result.updated += 1;
                            } else {
                                result.failed += 1;
                            }
                        }
                        if let Some(e) = etag {
                            cache.etags.insert(app_id.clone(), e);
                        }
                    }
                    None => result.failed += 1,
                }
            }
            _ => {
                let (downloaded, failed) =
                    backfill_manifests(&client, &steam_path, app_id, &present).await;
                result.updated += downloaded;
                result.failed += failed;
                if downloaded == 0 && failed == 0 {
                    result.skipped += 1;
                }
            }
        }
    }

    cache.last_check = now;
    save_cache(&cache);
    let _ = app.emit("fix-progress", String::new());

    Ok(result)
}
