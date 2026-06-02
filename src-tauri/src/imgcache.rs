use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use tauri::http::{header, Response, StatusCode};

const CACHE_CAP_BYTES: u64 = 256 * 1024 * 1024;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Veil/2.0")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_default()
    })
}

fn images_dir() -> PathBuf {
    let dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Veil")
        .join("images");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn key_for(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn pct_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |c: u8| -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    };
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        "image/png"
    } else if bytes.len() >= 3 && &bytes[0..3] == b"GIF" {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn ok(bytes: Vec<u8>) -> Response<Vec<u8>> {
    let ctype = content_type(&bytes);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

const PLACEHOLDER: &[u8] = include_bytes!("../../public/icons/placeholder.svg");

fn placeholder() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/svg+xml")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(PLACEHOLDER.to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

async fn try_fetch(url: &str) -> Option<Vec<u8>> {
    let resp = client().get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() {
        None
    } else {
        Some(bytes.to_vec())
    }
}

async fn appdetails_header(app_id: &str) -> Option<String> {
    let url = format!("https://store.steampowered.com/api/appdetails?appids={}&l=en", app_id);
    let json = client().get(&url).send().await.ok()?.json::<serde_json::Value>().await.ok()?;
    json[app_id]["data"]["header_image"].as_str().map(|s| s.to_string())
}

// Resolves a game's header art entirely server-side (CDN chain -> appdetails),
// caches by app id, and returns a placeholder image (never a 404) so the
// webview console stays quiet.
async fn serve_app(app_id: &str) -> Response<Vec<u8>> {
    let file = images_dir().join(format!("app_{}", app_id));
    if let Ok(bytes) = fs::read(&file) {
        if !bytes.is_empty() {
            return ok(bytes);
        }
    }

    let cdn = [
        format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg", app_id),
        format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg", app_id),
    ];
    for url in &cdn {
        if let Some(bytes) = try_fetch(url).await {
            let _ = fs::write(&file, &bytes);
            return ok(bytes);
        }
    }

    if let Some(header) = appdetails_header(app_id).await {
        if let Some(bytes) = try_fetch(&header).await {
            let _ = fs::write(&file, &bytes);
            return ok(bytes);
        }
    }

    for variant in ["capsule_616x353.jpg", "capsule_231x87.jpg"] {
        let url = format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/{}", app_id, variant);
        if let Some(bytes) = try_fetch(&url).await {
            let _ = fs::write(&file, &bytes);
            return ok(bytes);
        }
    }

    placeholder()
}

pub async fn serve(path: &str) -> Response<Vec<u8>> {
    let url = pct_decode(path.trim_start_matches('/'));

    if let Some(app_id) = url.strip_prefix("app/") {
        if !app_id.is_empty() && app_id.chars().all(|c| c.is_ascii_digit()) {
            return serve_app(app_id).await;
        }
        return placeholder();
    }

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return not_found();
    }

    let file = images_dir().join(key_for(&url));
    if let Ok(bytes) = fs::read(&file) {
        if !bytes.is_empty() {
            return ok(bytes);
        }
    }

    if let Some(bytes) = try_fetch(&url).await {
        let _ = fs::write(&file, &bytes);
        return ok(bytes);
    }

    not_found()
}

#[tauri::command]
pub fn prune_image_cache() {
    let dir = images_dir();
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total = 0u64;

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let len = meta.len();
                    total += len;
                    files.push((entry.path(), len, meta.modified().unwrap_or(UNIX_EPOCH)));
                }
            }
        }
    }

    if total <= CACHE_CAP_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, len, _) in files {
        if total <= CACHE_CAP_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}
