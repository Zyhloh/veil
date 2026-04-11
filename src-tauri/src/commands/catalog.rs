use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

const MANIFESTHUB_OWNER: &str = "SSMGAlt";
const MANIFESTHUB_REPO: &str = "ManifestHub2";

const STEAMSPY_PAGES: u32 = 6;

const STEAMSPY_CACHE_TTL_SECS: u64 = 60 * 60 * 24 * 7;

static POPULAR_APPS: tokio::sync::OnceCell<Mutex<Option<Arc<Vec<(u32, String)>>>>> =
    tokio::sync::OnceCell::const_new();

async fn popular_cell() -> &'static Mutex<Option<Arc<Vec<(u32, String)>>>> {
    POPULAR_APPS
        .get_or_init(|| async { Mutex::new(None) })
        .await
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/1.0 (+https://github.com/Zyhloh/veil)")
        .build()
        .map_err(|e| format!("http client: {}", e))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn popular_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("No cache dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
    Ok(dir.join("steamspy_popular.json"))
}

#[derive(Serialize, Deserialize)]
struct PopularCache {
    fetched_at: u64,
    apps: Vec<(u32, String)>,
}

async fn fetch_popular_from_steamspy(
    client: &reqwest::Client,
) -> Result<Vec<(u32, String)>, String> {
    let mut collected: HashMap<u32, String> = HashMap::new();

    for page in 0..STEAMSPY_PAGES {
        let url = format!("https://steamspy.com/api.php?request=all&page={}", page);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("steamspy page {}: {}", page, e))?;
        if !resp.status().is_success() {
            if !collected.is_empty() {
                break;
            }
            return Err(format!(
                "steamspy page {} returned {}",
                page,
                resp.status()
            ));
        }
        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("steamspy page {} parse: {}", page, e))?;
        let Some(obj) = json.as_object() else {
            break;
        };
        if obj.is_empty() {
            break;
        }
        for (_k, v) in obj {
            let id = v.get("appid").and_then(|v| v.as_u64());
            let name = v.get("name").and_then(|v| v.as_str());
            if let (Some(id), Some(name)) = (id, name) {
                if name.trim().is_empty() {
                    continue;
                }
                collected.entry(id as u32).or_insert_with(|| name.to_string());
            }
        }
    }

    let mut out: Vec<(u32, String)> = collected.into_iter().collect();
    out.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
    Ok(out)
}

async fn get_popular_apps(
    app: &AppHandle,
    client: &reqwest::Client,
) -> Arc<Vec<(u32, String)>> {
    let cell = popular_cell().await;

    {
        let guard = cell.lock().await;
        if let Some(list) = guard.as_ref() {
            return list.clone();
        }
    }

    if let Ok(path) = popular_cache_path(app) {
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(cache) = serde_json::from_slice::<PopularCache>(&bytes) {
                let age = now_secs().saturating_sub(cache.fetched_at);
                if age < STEAMSPY_CACHE_TTL_SECS && !cache.apps.is_empty() {
                    let arc = Arc::new(cache.apps);
                    let mut guard = cell.lock().await;
                    *guard = Some(arc.clone());
                    return arc;
                }
            }
        }
    }

    match fetch_popular_from_steamspy(client).await {
        Ok(apps) if !apps.is_empty() => {
            if let Ok(path) = popular_cache_path(app) {
                let cache = PopularCache {
                    fetched_at: now_secs(),
                    apps: apps.clone(),
                };
                if let Ok(bytes) = serde_json::to_vec(&cache) {
                    let _ = fs::write(&path, bytes);
                }
            }
            let arc = Arc::new(apps);
            let mut guard = cell.lock().await;
            *guard = Some(arc.clone());
            arc
        }
        _ => Arc::new(Vec::new()),
    }
}

fn fuzzy_rank(name: &str, q: &str) -> Option<i32> {
    let n = name.to_lowercase();
    let q = q.to_lowercase();
    if n == q {
        return Some(0);
    }
    if n.starts_with(&q) {
        return Some(10 + (n.len() as i32 - q.len() as i32));
    }
    for word in n.split_whitespace() {
        if word.starts_with(&q) {
            return Some(50 + (n.len() as i32));
        }
    }
    if n.contains(&q) {
        return Some(200 + (n.len() as i32));
    }
    None
}

#[derive(Serialize, Clone)]
pub struct CatalogSearchItem {
    pub app_id: u32,
    pub name: String,
    pub header_url: String,
    pub kind: String,
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
    #[serde(default)]
    tiny_image: Option<String>,
}

fn header_url(app_id: u32, hash: Option<&str>) -> String {
    if let Some(h) = hash {
        format!(
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{}/{}",
            app_id, h
        )
    } else {
        format!(
            "https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg",
            app_id
        )
    }
}

async fn search_store(
    client: &reqwest::Client,
    term: &str,
) -> Result<Vec<CatalogSearchItem>, String> {
    let resp = client
        .get("https://store.steampowered.com/api/storesearch/")
        .query(&[("term", term), ("cc", "us"), ("l", "en")])
        .send()
        .await
        .map_err(|e| format!("store search: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("store search returned {}", resp.status()));
    }

    let parsed: StoreSearchResp = resp
        .json()
        .await
        .map_err(|e| format!("store search parse: {}", e))?;

    Ok(parsed
        .items
        .into_iter()
        .map(|it| {
            let _ = it.tiny_image;
            CatalogSearchItem {
                app_id: it.id,
                name: it.name,
                header_url: header_url(it.id, None),
                kind: "app".to_string(),
            }
        })
        .collect())
}

async fn lookup_by_id(
    client: &reqwest::Client,
    app_id: u32,
) -> Result<Option<CatalogSearchItem>, String> {
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("steamcmd fetch: {}", e))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("steamcmd parse: {}", e))?;

    let data = json
        .get("data")
        .and_then(|d| d.get(app_id.to_string()))
        .cloned();
    let Some(data) = data else {
        return Ok(None);
    };

    let common = data.get("common").cloned().unwrap_or(Value::Null);
    let name = common
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return Ok(None);
    }

    let kind = common
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("app")
        .to_lowercase();

    let header_hash = match common.get("header_image") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Object(_)) => common
            .get("header_image")
            .and_then(|v| v.get("english"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    };

    Ok(Some(CatalogSearchItem {
        app_id,
        name,
        header_url: header_url(app_id, header_hash.as_deref()),
        kind,
    }))
}

#[tauri::command]
pub async fn catalog_search(
    app: AppHandle,
    query: String,
) -> Result<Vec<CatalogSearchItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = http_client()?;

    if let Ok(app_id) = q.parse::<u32>() {
        return match lookup_by_id(&client, app_id).await? {
            Some(item) => Ok(vec![item]),
            None => Ok(Vec::new()),
        };
    }

    let store_fut = search_store(&client, q);
    let popular_fut = get_popular_apps(&app, &client);
    let (store_res, popular) = tokio::join!(store_fut, popular_fut);

    let mut out: Vec<CatalogSearchItem> = store_res.unwrap_or_default();
    let mut seen: std::collections::HashSet<u32> = out.iter().map(|i| i.app_id).collect();

    let mut ranked: Vec<(i32, u32, String)> = popular
        .iter()
        .filter_map(|(id, name)| fuzzy_rank(name, q).map(|r| (r, *id, name.clone())))
        .collect();
    ranked.sort_by_key(|(r, _, _)| *r);

    for (_, id, name) in ranked.into_iter().take(40) {
        if seen.insert(id) {
            out.push(CatalogSearchItem {
                app_id: id,
                name,
                header_url: header_url(id, None),
                kind: "app".to_string(),
            });
        }
    }

    out.truncate(30);
    Ok(out)
}

#[derive(Serialize)]
pub struct CatalogInstallResponse {
    pub installed: bool,
    pub path: String,
}

#[tauri::command]
pub async fn catalog_install_lua(
    app_id: u32,
    steam_path: String,
) -> Result<CatalogInstallResponse, String> {
    let stplugin = Path::new(&steam_path).join("config").join("stplug-in");
    fs::create_dir_all(&stplugin)
        .map_err(|e| format!("Failed to create stplug-in dir: {}", e))?;

    let url = format!(
        "https://raw.githubusercontent.com/{}/{}/refs/heads/{}/{}.lua",
        MANIFESTHUB_OWNER, MANIFESTHUB_REPO, app_id, app_id
    );

    let client = http_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("lua fetch: {}", e))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("No .lua available for app {}", app_id));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to download .lua for app {} (status {})",
            app_id,
            resp.status()
        ));
    }

    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("lua body: {}", e))?;

    if body.is_empty() {
        return Err(format!("Empty .lua returned for app {}", app_id));
    }

    let target = stplugin.join(format!("{}.lua", app_id));
    fs::write(&target, &body).map_err(|e| format!("lua write: {}", e))?;

    Ok(CatalogInstallResponse {
        installed: true,
        path: target.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn catalog_is_installed(app_id: u32, steam_path: String) -> Result<bool, String> {
    let p = Path::new(&steam_path)
        .join("config")
        .join("stplug-in")
        .join(format!("{}.lua", app_id));
    Ok(p.exists())
}
