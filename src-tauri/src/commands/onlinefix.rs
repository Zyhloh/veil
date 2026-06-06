use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SEARCH_URL: &str = "https://online-fix.me/engine/ajax/search.php";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const LINK_PREFIX: &str = "https://online-fix.me/games/";

// Re-check cadence: a found fix rarely disappears; a missing one may appear later.
const AVAIL_TTL: u64 = 30 * 24 * 3600;
const UNAVAIL_TTL: u64 = 5 * 24 * 3600;

#[derive(Serialize, Deserialize, Clone)]
pub struct OnlineFixEntry {
    pub status: String, // "available" | "unavailable"
    pub url: Option<String>,
    pub checked_at: u64,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cache_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil")
        .join("online_fix_cache.json")
}

fn cache() -> &'static Mutex<HashMap<u32, OnlineFixEntry>> {
    static C: OnceLock<Mutex<HashMap<u32, OnlineFixEntry>>> = OnceLock::new();
    C.get_or_init(|| {
        let map = fs::read_to_string(cache_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Mutex::new(map)
    })
}

fn persist(map: &HashMap<u32, OnlineFixEntry>) {
    if let Ok(data) = serde_json::to_string(map) {
        let p = cache_path();
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(p, data);
    }
}

fn fresh(e: &OnlineFixEntry) -> bool {
    let ttl = if e.status == "available" { AVAIL_TTL } else { UNAVAIL_TTL };
    now().saturating_sub(e.checked_at) < ttl
}

fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn form_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// A Cloudflare/anti-bot interstitial rather than a real search response.
fn looks_blocked(status: u16, body: &str) -> bool {
    if status != 200 {
        return true;
    }
    let b = body.to_ascii_lowercase();
    b.contains("just a moment")
        || b.contains("attention required")
        || b.contains("cf-mitigated")
        || b.contains("/cdn-cgi/challenge")
}

/// Find the first /games/ result whose URL slug matches the app name. The slug is
/// ASCII even though the visible titles are Cyrillic, so matching stays reliable.
fn match_link(body: &str, name: &str) -> Option<String> {
    let name_n = norm(name);
    if name_n.len() < 2 {
        return None;
    }
    let mut search_from = 0usize;
    while let Some(rel) = body[search_from..].find(LINK_PREFIX) {
        let start = search_from + rel;
        // The URL begins at `start` and runs to the next quote.
        let tail = &body[start..];
        let end = tail.find('"').unwrap_or(tail.len());
        let url = &tail[..end];
        search_from = start + end;

        if !url.ends_with(".html") {
            continue;
        }
        if let Some(seg) = url.rsplit('/').next() {
            let slug = seg.trim_end_matches(".html");
            // strip the leading "<id>-" prefix online-fix prepends
            let slug = slug.splitn(2, '-').nth(1).unwrap_or(slug);
            if norm(slug).contains(&name_n) {
                return Some(url.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn online_fix_cached(app_ids: Vec<u32>) -> HashMap<u32, OnlineFixEntry> {
    let map = cache().lock().unwrap();
    let mut out = HashMap::new();
    for id in app_ids {
        if let Some(e) = map.get(&id) {
            if fresh(e) {
                out.insert(id, e.clone());
            }
        }
    }
    out
}

#[tauri::command]
pub async fn online_fix_fetch(app_id: u32, name: String) -> Result<OnlineFixEntry, String> {
    {
        let map = cache().lock().unwrap();
        if let Some(e) = map.get(&app_id) {
            if fresh(e) {
                return Ok(e.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(SEARCH_URL)
        .header("x-requested-with", "XMLHttpRequest")
        .header("referer", "https://online-fix.me/")
        .header("accept", "*/*")
        .header("content-type", "application/x-www-form-urlencoded; charset=UTF-8")
        .body(format!("query={}", form_encode(&name)))
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;

    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();

    if looks_blocked(status, &body) {
        return Err("rate_limited".to_string());
    }

    let url = match_link(&body, &name);
    let entry = OnlineFixEntry {
        status: if url.is_some() { "available".into() } else { "unavailable".into() },
        url,
        checked_at: now(),
    };

    {
        let mut map = cache().lock().unwrap();
        map.insert(app_id, entry.clone());
        persist(&map);
    }

    Ok(entry)
}
