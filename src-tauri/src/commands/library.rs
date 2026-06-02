use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;

const META_TTL_SECS: u64 = 60 * 60 * 24 * 7;
const FETCH_CONCURRENCY: usize = 12;

#[derive(Serialize, Clone)]
pub struct InstalledGame {
    pub app_id: String,
    pub included_app_ids: Vec<u32>,
    pub manifest_count: u32,
    pub install_dir: Option<String>,
    pub launch_exe: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppMeta {
    pub app_id: u32,
    pub name: String,
    pub header_url: String,
    pub kind: String,
    pub parent_app_id: u32,
    pub dlc_app_ids: Vec<u32>,
    pub released: bool,
}

#[derive(Serialize, Deserialize)]
struct CachedMeta {
    fetched_at: u64,
    meta: AppMeta,
}

fn stplugin_dir(steam_path: &str) -> PathBuf {
    PathBuf::from(steam_path).join("config").join("stplug-in")
}

fn meta_cache_dir() -> PathBuf {
    let dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil")
        .join("appmeta");
    fs::create_dir_all(&dir).ok();
    dir
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn steam_libraries(steam_path: &str) -> Vec<PathBuf> {
    let mut libraries = vec![PathBuf::from(steam_path)];
    let vdf = PathBuf::from(steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(&vdf) {
        if let Ok(re) = regex::Regex::new(r#""path"\s*"([^"]+)""#) {
            for cap in re.captures_iter(&content) {
                let path = PathBuf::from(cap[1].replace("\\\\", "\\"));
                if !libraries.contains(&path) {
                    libraries.push(path);
                }
            }
        }
    }
    libraries
}

fn find_install_dir(libraries: &[PathBuf], app_id: &str) -> Option<String> {
    let re = regex::Regex::new(r#""installdir"\s*"([^"]+)""#).ok()?;
    for library in libraries {
        let acf = library
            .join("steamapps")
            .join(format!("appmanifest_{}.acf", app_id));
        if let Ok(content) = fs::read_to_string(&acf) {
            if let Some(cap) = re.captures(&content) {
                let dir = library.join("steamapps").join("common").join(&cap[1]);
                if dir.exists() {
                    return Some(dir.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn list_installed_games(steam_path: String) -> Result<Vec<InstalledGame>, String> {
    let dir = stplugin_dir(&steam_path);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let app_re = regex::Regex::new(r"addappid\s*\(\s*(\d+)").map_err(|e| e.to_string())?;
    let depot_re = regex::Regex::new(r#"addappid\s*\(\s*\d+\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+""#)
        .map_err(|e| e.to_string())?;
    let libraries = steam_libraries(&steam_path);

    let mut games = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lua") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if stem.is_empty() || !stem.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        let content = fs::read_to_string(&path).unwrap_or_default();

        let mut included: BTreeSet<u32> = BTreeSet::new();
        for cap in app_re.captures_iter(&content) {
            if let Ok(id) = cap[1].parse::<u32>() {
                included.insert(id);
            }
        }

        let manifest_count = depot_re.find_iter(&content).count() as u32;
        let install_dir = find_install_dir(&libraries, &stem);

        games.push(InstalledGame {
            app_id: stem,
            included_app_ids: included.into_iter().collect(),
            manifest_count,
            install_dir,
            launch_exe: None,
        });
    }

    let mut targets: HashMap<u32, PathBuf> = HashMap::new();
    for game in &games {
        if let (Ok(id), Some(dir)) = (game.app_id.parse::<u32>(), game.install_dir.as_ref()) {
            targets.insert(id, PathBuf::from(dir));
        }
    }
    let launches = crate::appinfo::resolve_launches(&steam_path, &targets);
    for game in &mut games {
        if let Ok(id) = game.app_id.parse::<u32>() {
            game.launch_exe = launches.get(&id).map(|l| l.exe.clone());
        }
    }

    games.sort_by(|a, b| a.app_id.cmp(&b.app_id));
    Ok(games)
}

fn release_timestamp(common: &serde_json::Value) -> u64 {
    for key in ["steam_release_date", "original_release_date", "store_release_date"] {
        let value = &common[key];
        let ts = value
            .as_u64()
            .or_else(|| value.as_str().and_then(|s| s.parse::<u64>().ok()))
            .unwrap_or(0);
        if ts != 0 {
            return ts;
        }
    }
    0
}

fn parse_meta(app_id: u32, json: &serde_json::Value) -> AppMeta {
    let mut meta = AppMeta {
        app_id,
        name: format!("App {}", app_id),
        header_url: String::new(),
        kind: "game".to_string(),
        parent_app_id: 0,
        dlc_app_ids: Vec::new(),
        released: false,
    };

    let data = &json["data"][app_id.to_string()];
    let common = &data["common"];

    let has_name = common["name"].as_str().map(|n| !n.is_empty()).unwrap_or(false);
    if has_name {
        meta.name = common["name"].as_str().unwrap_or(&meta.name).to_string();
    }

    let state = common["releasestate"].as_str().unwrap_or("released");
    let unreleased = matches!(state, "prerelease" | "preloadonly" | "disabled");
    let release_ts = release_timestamp(common);
    let out_now = release_ts != 0 && release_ts <= now_secs();
    meta.released = has_name && !unreleased && out_now;
    if let Some(kind) = common["type"].as_str() {
        meta.kind = kind.to_lowercase();
    }

    let hash = common["header_image"]["english"]
        .as_str()
        .or_else(|| common["header_image"].as_str());
    if let Some(hash) = hash {
        if !hash.is_empty() {
            meta.header_url = format!(
                "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{}/{}",
                app_id, hash
            );
        }
    }

    meta.parent_app_id = common["parent"]
        .as_str()
        .and_then(|p| p.parse().ok())
        .or_else(|| common["parent"].as_u64().map(|p| p as u32))
        .unwrap_or(0);

    if let Some(list) = data["extended"]["listofdlc"].as_str() {
        meta.dlc_app_ids = list
            .split(',')
            .filter_map(|s| s.trim().parse::<u32>().ok())
            .collect();
    }

    meta
}

async fn fetch_meta(client: &reqwest::Client, app_id: u32) -> AppMeta {
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    match client.get(&url).send().await {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(json) => parse_meta(app_id, &json),
            Err(_) => parse_meta(app_id, &serde_json::Value::Null),
        },
        Err(_) => parse_meta(app_id, &serde_json::Value::Null),
    }
}

#[tauri::command]
pub async fn get_apps_meta(app_ids: Vec<u32>) -> Result<Vec<AppMeta>, String> {
    let dir = meta_cache_dir();
    let now = now_secs();

    let mut result: Vec<AppMeta> = Vec::new();
    let mut to_fetch: Vec<u32> = Vec::new();

    for id in app_ids {
        let cache_file = dir.join(format!("{}.json", id));
        if let Ok(data) = fs::read_to_string(&cache_file) {
            if let Ok(cached) = serde_json::from_str::<CachedMeta>(&data) {
                if now.saturating_sub(cached.fetched_at) < META_TTL_SECS {
                    result.push(cached.meta);
                    continue;
                }
            }
        }
        to_fetch.push(id);
    }

    if !to_fetch.is_empty() {
        let client = reqwest::Client::builder()
            .user_agent("Veil/2.0")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;

        let mut set = tokio::task::JoinSet::new();
        let mut iter = to_fetch.into_iter();

        for _ in 0..FETCH_CONCURRENCY {
            if let Some(id) = iter.next() {
                let client = client.clone();
                set.spawn(async move { fetch_meta(&client, id).await });
            }
        }

        while let Some(joined) = set.join_next().await {
            if let Ok(meta) = joined {
                let cached = CachedMeta {
                    fetched_at: now,
                    meta: meta.clone(),
                };
                if let Ok(serialized) = serde_json::to_string(&cached) {
                    let _ = fs::write(dir.join(format!("{}.json", meta.app_id)), serialized);
                }
                result.push(meta);
            }
            if let Some(id) = iter.next() {
                let client = client.clone();
                set.spawn(async move { fetch_meta(&client, id).await });
            }
        }
    }

    Ok(result)
}

fn remove_depot_caches(steam_path: &str, depots: &BTreeSet<String>) {
    if depots.is_empty() {
        return;
    }
    let depotcaches = [
        PathBuf::from(steam_path).join("config").join("depotcache"),
        PathBuf::from(steam_path).join("depotcache"),
    ];
    for base in depotcaches {
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if depots.iter().any(|d| name.starts_with(&format!("{}_", d))) {
                        fs::remove_file(&path).ok();
                    }
                }
            }
        }
    }
}

fn remove_manifest_files(steam_path: &str, app_id: &str) {
    let lua_path = stplugin_dir(steam_path).join(format!("{}.lua", app_id));

    let mut depots: BTreeSet<String> = BTreeSet::new();
    if let Ok(re) = regex::Regex::new(r#"addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+""#) {
        if let Ok(content) = fs::read_to_string(&lua_path) {
            for cap in re.captures_iter(&content) {
                depots.insert(cap[1].to_string());
            }
        }
    }

    fs::remove_file(&lua_path).ok();
    remove_depot_caches(steam_path, &depots);
}

#[tauri::command]
pub fn uninstall_dlc(steam_path: String, main_app_id: u32, dlc_id: u32) -> Result<(), String> {
    let stplugin = stplugin_dir(&steam_path);

    let own_lua = stplugin.join(format!("{}.lua", dlc_id));
    if own_lua.exists() {
        remove_manifest_files(&steam_path, &dlc_id.to_string());
    }

    let main_lua = stplugin.join(format!("{}.lua", main_app_id));
    if main_lua.exists() {
        if let Ok(content) = fs::read_to_string(&main_lua) {
            let re = regex::Regex::new(&format!(r"(?m)^[^\S\r\n]*addappid\s*\(\s*{}\b.*\r?\n?", dlc_id))
                .map_err(|e| e.to_string())?;
            let next = re.replace_all(&content, "").to_string();
            if next != content {
                let tmp = main_lua.with_extension("lua.tmp");
                fs::write(&tmp, &next).map_err(|e| e.to_string())?;
                fs::rename(&tmp, &main_lua).map_err(|e| e.to_string())?;
            }
        }
    }

    let mut depots = BTreeSet::new();
    depots.insert(dlc_id.to_string());
    remove_depot_caches(&steam_path, &depots);

    Ok(())
}

fn kill_processes_in_dir(dir: &Path) {
    let system = System::new_all();
    for proc in system.processes().values() {
        if let Some(exe) = proc.exe() {
            if exe.starts_with(dir) {
                proc.kill();
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
}

#[tauri::command]
pub fn remove_manifest(steam_path: String, app_id: String) -> Result<(), String> {
    remove_manifest_files(&steam_path, &app_id);
    Ok(())
}

#[tauri::command]
pub fn launch_game_direct(steam_path: String, app_id: String) -> Result<(), String> {
    let id: u32 = app_id.parse().map_err(|_| "Invalid app id".to_string())?;
    let libraries = steam_libraries(&steam_path);
    let dir = find_install_dir(&libraries, &app_id).ok_or_else(|| "Game files are not installed".to_string())?;

    let mut targets = std::collections::HashMap::new();
    targets.insert(id, PathBuf::from(dir));
    let resolved = crate::appinfo::resolve_launches(&steam_path, &targets);
    let launch = resolved
        .get(&id)
        .ok_or_else(|| "Could not resolve a launch executable".to_string())?;

    let mut cmd = std::process::Command::new(&launch.exe);
    cmd.current_dir(&launch.workdir);
    cmd.args(&launch.args);
    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch game: {}", e))
}

#[tauri::command]
pub fn uninstall_game(steam_path: String, app_id: String) -> Result<(), String> {
    let libraries = steam_libraries(&steam_path);
    let re = regex::Regex::new(r#""installdir"\s*"([^"]+)""#).map_err(|e| e.to_string())?;

    for library in &libraries {
        let acf = library
            .join("steamapps")
            .join(format!("appmanifest_{}.acf", app_id));
        if let Ok(content) = fs::read_to_string(&acf) {
            if let Some(cap) = re.captures(&content) {
                let dir = library.join("steamapps").join("common").join(&cap[1]);
                if dir.exists() {
                    kill_processes_in_dir(&dir);
                    fs::remove_dir_all(&dir).ok();
                }
            }
            fs::remove_file(&acf).ok();
        }
    }

    remove_manifest_files(&steam_path, &app_id);
    Ok(())
}
