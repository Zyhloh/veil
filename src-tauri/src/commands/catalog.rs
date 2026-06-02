use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub const MH_OWNER: &str = "SSMGAlt";
pub const MH_REPO: &str = "ManifestHub2";

pub const SKY_BASE: &str = "https://raw.githubusercontent.com/skyflarefox/Skyapi/refs/heads/main";
const APPLIST_TTL_SECS: u64 = 60 * 60 * 24;
const TRENDING_TTL_SECS: u64 = 60 * 60 * 6;

#[derive(Serialize, Clone)]
pub struct CatalogItem {
    pub app_id: u32,
    pub name: String,
    pub header_url: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/2.0 (+https://github.com/Zyhloh/veil)")
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

fn cache_dir() -> PathBuf {
    let dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil")
        .join("catalog");
    fs::create_dir_all(&dir).ok();
    dir
}

fn header_url(app_id: u32, hash: Option<&str>) -> String {
    match hash {
        Some(h) => format!(
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{}/{}",
            app_id, h
        ),
        None => format!(
            "https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg",
            app_id
        ),
    }
}

#[derive(Serialize, Deserialize)]
struct ListCache {
    fetched_at: u64,
    apps: Vec<(u32, String)>,
}

static APPLIST: OnceLock<Mutex<Option<Arc<Vec<(u32, String, String)>>>>> = OnceLock::new();

fn applist_cell() -> &'static Mutex<Option<Arc<Vec<(u32, String, String)>>>> {
    APPLIST.get_or_init(|| Mutex::new(None))
}

async fn full_app_list(client: &reqwest::Client) -> Arc<Vec<(u32, String, String)>> {
    if let Some(list) = applist_cell().lock().await.as_ref() {
        return list.clone();
    }

    let path = cache_dir().join("applist.json");
    let mut raw: Option<Vec<(u32, String)>> = None;
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(cache) = serde_json::from_slice::<ListCache>(&bytes) {
            if now_secs().saturating_sub(cache.fetched_at) < APPLIST_TTL_SECS && !cache.apps.is_empty() {
                raw = Some(cache.apps);
            }
        }
    }

    if raw.is_none() {
        if let Ok(resp) = client.get("https://app.projectveil.cc/games").send().await {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(apps) = json["apps"].as_array() {
                    let mut collected: Vec<(u32, String)> = Vec::with_capacity(apps.len());
                    for app in apps {
                        let Some(pair) = app.as_array() else { continue };
                        let id = pair.first().and_then(|v| v.as_u64());
                        let name = pair.get(1).and_then(|v| v.as_str()).map(str::trim);
                        if let (Some(id), Some(name)) = (id, name) {
                            if !name.is_empty() {
                                collected.push((id as u32, name.to_string()));
                            }
                        }
                    }
                    if !collected.is_empty() {
                        let cache = ListCache { fetched_at: now_secs(), apps: collected.clone() };
                        if let Ok(bytes) = serde_json::to_vec(&cache) {
                            let _ = fs::write(&path, bytes);
                        }
                        raw = Some(collected);
                    }
                }
            }
        }
    }

    let with_lower: Vec<(u32, String, String)> = raw
        .unwrap_or_default()
        .into_iter()
        .map(|(id, name)| {
            let lower = name.to_lowercase();
            (id, name, lower)
        })
        .collect();
    let arc = Arc::new(with_lower);
    if !arc.is_empty() {
        *applist_cell().lock().await = Some(arc.clone());
    }
    arc
}

fn rank_lower(name_lower: &str, query: &str, qtokens: &[&str]) -> Option<i32> {
    if name_lower == query {
        return Some(0);
    }
    if name_lower.starts_with(query) {
        return Some(10 + (name_lower.len() as i32 - query.len() as i32));
    }
    if query.starts_with(name_lower) && name_lower.len() >= 4 {
        return Some(30 + (query.len() as i32 - name_lower.len() as i32));
    }
    if qtokens.is_empty() {
        return None;
    }
    let matched = qtokens.iter().filter(|t| name_lower.contains(**t)).count();
    if matched == qtokens.len() {
        return Some(80 + name_lower.len() as i32);
    }
    if qtokens.len() >= 2 && matched + 1 >= qtokens.len() {
        return Some(200 + name_lower.len() as i32);
    }
    None
}

#[derive(Deserialize)]
struct StoreSearchResp {
    #[serde(default)]
    items: Vec<StoreSearchItem>,
}

#[derive(Deserialize)]
struct StoreSearchItem {
    id: u32,
    name: String,
    #[serde(rename = "type", default)]
    kind: String,
}

async fn search_store(client: &reqwest::Client, term: &str) -> Vec<CatalogItem> {
    let Ok(url) = reqwest::Url::parse_with_params(
        "https://store.steampowered.com/api/storesearch/",
        &[("term", term), ("cc", "us"), ("l", "en")],
    ) else {
        return Vec::new();
    };
    let resp = client.get(url).send().await;
    let Ok(resp) = resp else { return Vec::new() };
    if !resp.status().is_success() {
        return Vec::new();
    }
    match resp.json::<StoreSearchResp>().await {
        Ok(parsed) => parsed
            .items
            .into_iter()
            .filter(|it| it.kind.is_empty() || it.kind == "app" || it.kind == "game")
            .map(|it| CatalogItem {
                app_id: it.id,
                name: it.name,
                header_url: header_url(it.id, None),
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

async fn lookup_by_id(client: &reqwest::Client, app_id: u32) -> Option<CatalogItem> {
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: Value = resp.json().await.ok()?;
    let common = &json["data"][app_id.to_string()]["common"];
    let name = common["name"].as_str().unwrap_or("").to_string();
    if name.is_empty() {
        return None;
    }
    let hash = common["header_image"]["english"]
        .as_str()
        .or_else(|| common["header_image"].as_str());
    Some(CatalogItem {
        app_id,
        name,
        header_url: header_url(app_id, hash),
    })
}

#[tauri::command]
pub async fn catalog_search(query: String) -> Result<Vec<CatalogItem>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = http_client()?;

    if let Ok(app_id) = q.parse::<u32>() {
        return Ok(lookup_by_id(&client, app_id).await.into_iter().collect());
    }

    let (store, apps) = tokio::join!(search_store(&client, &q), full_app_list(&client));

    let mut out = store;
    let mut seen: HashSet<u32> = out.iter().map(|i| i.app_id).collect();

    let qtokens: Vec<&str> = q.split_whitespace().collect();
    let mut ranked: Vec<(i32, u32, &str)> = Vec::new();
    for (id, name, lower) in apps.iter() {
        if seen.contains(id) {
            continue;
        }
        if let Some(r) = rank_lower(lower, &q, &qtokens) {
            ranked.push((r, *id, name.as_str()));
        }
    }
    ranked.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.len().cmp(&b.2.len())));

    for (_, id, name) in ranked.into_iter().take(60) {
        if seen.insert(id) {
            out.push(CatalogItem {
                app_id: id,
                name: name.to_string(),
                header_url: header_url(id, None),
            });
        }
    }

    out.truncate(60);
    Ok(out)
}

#[tauri::command]
pub async fn catalog_trending() -> Result<Vec<CatalogItem>, String> {
    let path = cache_dir().join("trending.json");
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(cache) = serde_json::from_slice::<ListCache>(&bytes) {
            if now_secs().saturating_sub(cache.fetched_at) < TRENDING_TTL_SECS && !cache.apps.is_empty() {
                return Ok(cache
                    .apps
                    .into_iter()
                    .map(|(id, name)| CatalogItem { app_id: id, name, header_url: header_url(id, None) })
                    .collect());
            }
        }
    }

    let client = http_client()?;
    let resp = client
        .get("https://steamspy.com/api.php?request=top100in2weeks")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let Some(obj) = json.as_object() else {
        return Ok(Vec::new());
    };

    let mut ranked: Vec<(u64, u32, String)> = Vec::new();
    for (_, v) in obj {
        let id = v.get("appid").and_then(|v| v.as_u64());
        let name = v.get("name").and_then(|v| v.as_str());
        let weight = v.get("average_2weeks").and_then(|v| v.as_u64()).unwrap_or(0);
        if let (Some(id), Some(name)) = (id, name) {
            if !name.trim().is_empty() {
                ranked.push((weight, id as u32, name.to_string()));
            }
        }
    }
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked.truncate(48);

    let apps: Vec<(u32, String)> = ranked.iter().map(|(_, id, name)| (*id, name.clone())).collect();
    let cache = ListCache { fetched_at: now_secs(), apps: apps.clone() };
    if let Ok(bytes) = serde_json::to_vec(&cache) {
        let _ = fs::write(&path, bytes);
    }

    Ok(apps
        .into_iter()
        .map(|(id, name)| CatalogItem { app_id: id, name, header_url: header_url(id, None) })
        .collect())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogDetails {
    pub app_id: u32,
    pub name: String,
    pub short_description: String,
    pub header_image: String,
    pub screenshots: Vec<String>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub genres: Vec<String>,
    pub release_date: String,
    pub price: String,
    pub is_free: bool,
    pub website: String,
    pub dlc_app_ids: Vec<u32>,
}

#[derive(Serialize, Deserialize)]
struct CachedDetails {
    fetched_at: u64,
    details: CatalogDetails,
}

const DETAILS_TTL_SECS: u64 = 60 * 60 * 24;

fn str_vec(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn catalog_details(app_id: u32) -> Result<CatalogDetails, String> {
    let cache_file = cache_dir().join("details").join(format!("{}.json", app_id));
    if let Some(parent) = cache_file.parent() {
        fs::create_dir_all(parent).ok();
    }
    if let Ok(data) = fs::read_to_string(&cache_file) {
        if let Ok(cached) = serde_json::from_str::<CachedDetails>(&data) {
            if now_secs().saturating_sub(cached.fetched_at) < DETAILS_TTL_SECS {
                return Ok(cached.details);
            }
        }
    }

    let mut details = CatalogDetails {
        app_id,
        name: format!("App {}", app_id),
        short_description: String::new(),
        header_image: header_url(app_id, None),
        screenshots: Vec::new(),
        developers: Vec::new(),
        publishers: Vec::new(),
        genres: Vec::new(),
        release_date: String::new(),
        price: String::new(),
        is_free: false,
        website: String::new(),
        dlc_app_ids: Vec::new(),
    };

    let client = http_client()?;
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let entry = &json[app_id.to_string()];
    if !entry["success"].as_bool().unwrap_or(false) {
        return Ok(details);
    }
    let data = &entry["data"];

    if let Some(name) = data["name"].as_str() {
        details.name = name.to_string();
    }
    details.short_description = data["short_description"].as_str().unwrap_or("").to_string();
    if let Some(h) = data["header_image"].as_str() {
        details.header_image = h.to_string();
    }
    details.developers = str_vec(&data["developers"]);
    details.publishers = str_vec(&data["publishers"]);
    details.release_date = data["release_date"]["date"].as_str().unwrap_or("").to_string();
    details.website = data["website"].as_str().unwrap_or("").to_string();
    details.is_free = data["is_free"].as_bool().unwrap_or(false);

    details.genres = data["genres"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|g| g["description"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    details.screenshots = data["screenshots"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s["path_full"].as_str().map(|s| s.to_string()))
                .take(8)
                .collect()
        })
        .unwrap_or_default();

    details.price = if details.is_free {
        "Free".to_string()
    } else {
        data["price_overview"]["final_formatted"].as_str().unwrap_or("").to_string()
    };

    details.dlc_app_ids = data["dlc"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect())
        .unwrap_or_default();

    let cached = CachedDetails {
        fetched_at: now_secs(),
        details: details.clone(),
    };
    if let Ok(serialized) = serde_json::to_string(&cached) {
        let _ = fs::write(&cache_file, serialized);
    }

    Ok(details)
}

async fn fetch_lua(client: &reqwest::Client, app_id: u32, git_ref: &str) -> Result<Vec<u8>, String> {
    let url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}.lua",
        MH_OWNER, MH_REPO, git_ref, app_id
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("No manifest available for app {}", app_id));
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to download manifest (status {})", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    if body.is_empty() {
        return Err(format!("Empty manifest returned for app {}", app_id));
    }
    Ok(body.to_vec())
}

async fn fetch_manifests(client: &reqwest::Client, git_ref: &str) -> Vec<(String, Vec<u8>)> {
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        MH_OWNER, MH_REPO, git_ref
    );
    let Ok(resp) = client
        .get(&tree_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(json) = resp.json::<Value>().await else {
        return Vec::new();
    };
    let Some(tree) = json["tree"].as_array() else {
        return Vec::new();
    };

    let paths: Vec<String> = tree
        .iter()
        .filter_map(|n| {
            let path = n["path"].as_str()?;
            if n["type"].as_str() == Some("blob") && path.ends_with(".manifest") {
                Some(path.to_string())
            } else {
                None
            }
        })
        .collect();

    let mut out = Vec::new();
    for path in paths {
        let url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            MH_OWNER, MH_REPO, git_ref, path
        );
        if let Ok(r) = client.get(&url).send().await {
            if r.status().is_success() {
                if let Ok(bytes) = r.bytes().await {
                    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                    out.push((name, bytes.to_vec()));
                }
            }
        }
    }
    out
}

pub fn lua_from_zip(bytes: &[u8]) -> Option<String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        if entry.name().to_lowercase().ends_with(".lua") {
            let mut buf = String::new();
            if std::io::Read::read_to_string(&mut entry, &mut buf).is_ok() && !buf.trim().is_empty() {
                return Some(buf);
            }
        }
    }
    None
}

async fn resolve_lua(client: &reqwest::Client, app_id: u32) -> Option<String> {
    let url = format!("{}/{}.zip", SKY_BASE, app_id);
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    lua_from_zip(bytes.as_ref())
}

async fn install_one(client: &reqwest::Client, steam_path: &str, app_id: u32) -> bool {
    let stplugin = Path::new(steam_path).join("config").join("stplug-in");
    if fs::create_dir_all(&stplugin).is_err() {
        return false;
    }
    if let Some(lua) = resolve_lua(client, app_id).await {
        return fs::write(stplugin.join(format!("{}.lua", app_id)), lua.as_bytes()).is_ok();
    }
    let branch = app_id.to_string();
    do_install(steam_path, app_id, &branch, &branch).await.is_ok()
}

async fn do_install(steam_path: &str, app_id: u32, lua_ref: &str, tree_ref: &str) -> Result<(), String> {
    let stplugin = Path::new(steam_path).join("config").join("stplug-in");
    fs::create_dir_all(&stplugin).map_err(|e| e.to_string())?;

    let client = http_client()?;
    let lua = fetch_lua(&client, app_id, lua_ref).await?;
    fs::write(stplugin.join(format!("{}.lua", app_id)), &lua).map_err(|e| e.to_string())?;

    let manifests = fetch_manifests(&client, tree_ref).await;
    if !manifests.is_empty() {
        let depot_a = Path::new(steam_path).join("config").join("depotcache");
        let depot_b = Path::new(steam_path).join("depotcache");
        fs::create_dir_all(&depot_a).ok();
        fs::create_dir_all(&depot_b).ok();
        for (name, data) in &manifests {
            let _ = fs::write(depot_a.join(name), data);
            let _ = fs::write(depot_b.join(name), data);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn catalog_install(app_id: u32, steam_path: String) -> Result<(), String> {
    let client = http_client()?;
    if install_one(&client, &steam_path, app_id).await {
        Ok(())
    } else {
        Err(format!("No manifest available for app {}", app_id))
    }
}

#[tauri::command]
pub async fn catalog_install_at(
    app_id: u32,
    steam_path: String,
    commit_sha: String,
) -> Result<(), String> {
    do_install(&steam_path, app_id, &commit_sha, &commit_sha).await
}

#[derive(Serialize)]
pub struct InstallStatus {
    pub app_id: u32,
    pub status: String,
}

#[derive(Serialize)]
pub struct SelectionResult {
    pub statuses: Vec<InstallStatus>,
    pub appended: u32,
}

#[derive(Serialize, Clone)]
struct SelProgress {
    done: u32,
    total: u32,
}

fn lua_contains_appid(content: &str, app_id: u32) -> bool {
    regex::Regex::new(&format!(r"(?m)^\s*addappid\s*\(\s*{}\b", app_id))
        .map(|re| re.is_match(content))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn catalog_install_selection(
    app: AppHandle,
    steam_path: String,
    main_app_id: u32,
    install_main: bool,
    dlcs: Vec<(u32, String)>,
) -> Result<SelectionResult, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    fs::create_dir_all(&stplugin).map_err(|e| e.to_string())?;
    let main_lua = stplugin.join(format!("{}.lua", main_app_id));
    let client = http_client()?;

    let total = install_main as u32 + dlcs.len() as u32;
    let mut done = 0u32;
    let emit = |app: &AppHandle, done: u32| {
        let _ = app.emit("selection-progress", SelProgress { done, total });
    };
    emit(&app, 0);

    let mut statuses: Vec<InstallStatus> = Vec::new();

    if install_main {
        let ok = install_one(&client, &steam_path, main_app_id).await;
        statuses.push(InstallStatus {
            app_id: main_app_id,
            status: if ok { "installed" } else { "failed" }.to_string(),
        });
        done += 1;
        emit(&app, done);
    }

    let mut to_append: Vec<(u32, String)> = Vec::new();
    for (id, name) in &dlcs {
        let installed = install_one(&client, &steam_path, *id).await;
        done += 1;
        emit(&app, done);
        if installed {
            statuses.push(InstallStatus {
                app_id: *id,
                status: "installed".to_string(),
            });
        } else {
            to_append.push((*id, name.clone()));
        }
    }

    let mut appended = 0u32;
    if !to_append.is_empty() {
        if !main_lua.exists() {
            install_one(&client, &steam_path, main_app_id).await;
        }
        if main_lua.exists() {
            let content = fs::read_to_string(&main_lua).unwrap_or_default();
            let mut next = content.clone();
            let mut newly: Vec<u32> = Vec::new();
            for (id, name) in &to_append {
                if lua_contains_appid(&content, *id) {
                    continue;
                }
                if !next.is_empty() && !next.ends_with('\n') {
                    next.push('\n');
                }
                next.push_str(&format!("addappid({}) -- {}\n", id, name));
                newly.push(*id);
            }

            let write_ok = if newly.is_empty() {
                true
            } else {
                let tmp = main_lua.with_extension("lua.tmp");
                fs::write(&tmp, &next).is_ok() && fs::rename(&tmp, &main_lua).is_ok()
            };
            if write_ok {
                appended = newly.len() as u32;
            }

            for (id, _) in &to_append {
                let status = if newly.contains(id) {
                    if write_ok { "appended" } else { "failed" }
                } else {
                    "appended"
                };
                statuses.push(InstallStatus { app_id: *id, status: status.to_string() });
            }
        } else {
            for (id, _) in &to_append {
                statuses.push(InstallStatus { app_id: *id, status: "missing_base".to_string() });
            }
        }
    }

    Ok(SelectionResult { statuses, appended })
}

#[derive(Serialize)]
pub struct CatalogVersion {
    pub sha: String,
    pub short_sha: String,
    pub date: String,
    pub message: String,
    pub build_id: Option<String>,
}

fn parse_build_id(message: &str) -> Option<String> {
    let patterns = [
        r"(?i)\bbuild[\s_\-:]*#?(\d{5,})",
        r"(?i)\bbuildid[\s_\-:]*#?(\d{5,})",
        r"\b(\d{6,12})\b",
    ];
    for pat in patterns {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(cap) = re.captures(message) {
                if let Some(m) = cap.get(1) {
                    return Some(m.as_str().to_string());
                }
            }
        }
    }
    None
}

fn is_maintenance_commit(message: &str) -> bool {
    let lower = message.to_lowercase();
    const NEEDLES: &[&str] = &[
        "depotkey", "depot key", "access token", "add access", "update access",
        "update token", "refresh token", "readme", ".md", "license", "gitignore",
        "workflow", ".yml", ".yaml", "ci:", "chore:",
    ];
    NEEDLES.iter().any(|n| lower.contains(n))
}

#[tauri::command]
pub async fn catalog_list_versions(app_id: u32) -> Result<Vec<CatalogVersion>, String> {
    let client = http_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/commits?sha={}&per_page=50",
        MH_OWNER, MH_REPO, app_id
    );

    let arr: Vec<Value> = match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mut out: Vec<CatalogVersion> = Vec::new();
    for commit in &arr {
        let sha = commit["sha"].as_str().unwrap_or("").to_string();
        if sha.is_empty() {
            continue;
        }
        let message = commit["commit"]["message"]
            .as_str()
            .unwrap_or("")
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        let date = commit["commit"]["author"]["date"]
            .as_str()
            .or_else(|| commit["commit"]["committer"]["date"].as_str())
            .unwrap_or("")
            .to_string();
        if is_maintenance_commit(&message) {
            continue;
        }
        let Some(build_id) = parse_build_id(&message) else {
            continue;
        };
        out.push(CatalogVersion {
            short_sha: sha.chars().take(7).collect(),
            sha,
            date,
            message,
            build_id: Some(build_id),
        });
    }

    Ok(out)
}
