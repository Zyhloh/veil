use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct InstallEntry {
    pub name: String,
    pub kind: String,
    pub app_id: Option<u32>,
    pub status: String,
}

#[derive(Serialize)]
pub struct InstallReport {
    pub entries: Vec<InstallEntry>,
    pub lua_count: u32,
    pub manifest_count: u32,
    pub skipped: u32,
    pub app_ids: Vec<u32>,
}

struct Dest {
    steam_path: String,
    depot_a: PathBuf,
    depot_b: PathBuf,
}

fn basename(name: &str) -> String {
    Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn app_id_from_name(name: &str) -> Option<u32> {
    let stem = Path::new(name).file_stem()?.to_str()?;
    if !stem.is_empty() && stem.chars().all(|c| c.is_ascii_digit()) {
        stem.parse().ok()
    } else {
        None
    }
}

fn write_lua(dest: &Dest, name: &str, data: &[u8]) -> InstallEntry {
    let existed = super::plugin::dirs(&dest.steam_path)
        .iter()
        .any(|d| d.join(name).exists());
    let ok = super::plugin::write_to_all(&dest.steam_path, name, data).is_ok();
    InstallEntry {
        name: name.to_string(),
        kind: "lua".to_string(),
        app_id: app_id_from_name(name),
        status: if !ok {
            "failed"
        } else if existed {
            "replaced"
        } else {
            "installed"
        }
        .to_string(),
    }
}

fn write_manifest(dest: &Dest, name: &str, data: &[u8]) -> InstallEntry {
    let existed = dest.depot_a.join(name).exists() || dest.depot_b.join(name).exists();
    let ok = fs::write(dest.depot_a.join(name), data).is_ok()
        & fs::write(dest.depot_b.join(name), data).is_ok();
    InstallEntry {
        name: name.to_string(),
        kind: "manifest".to_string(),
        app_id: None,
        status: if !ok {
            "failed"
        } else if existed {
            "replaced"
        } else {
            "installed"
        }
        .to_string(),
    }
}

fn route(dest: &Dest, name: &str, data: &[u8]) -> Option<InstallEntry> {
    let lower = name.to_lowercase();
    if lower.ends_with(".lua") {
        Some(write_lua(dest, name, data))
    } else if lower.ends_with(".manifest") {
        Some(write_manifest(dest, name, data))
    } else {
        None
    }
}

fn build_report(
    app: &AppHandle,
    steam_path: &str,
    items: Vec<(String, Vec<u8>)>,
) -> Result<InstallReport, String> {
    let dest = Dest {
        steam_path: steam_path.to_string(),
        depot_a: Path::new(steam_path).join("config").join("depotcache"),
        depot_b: Path::new(steam_path).join("depotcache"),
    };
    fs::create_dir_all(&dest.depot_a).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dest.depot_b).map_err(|e| e.to_string())?;

    let mut entries: Vec<InstallEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut skipped = 0u32;

    for (name, data) in &items {
        let base = basename(name);
        let lower = base.to_lowercase();

        if lower.ends_with(".zip") {
            let _ = app.emit("install-progress", format!("Extracting {}…", base));
            let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(data.as_slice())) {
                Ok(a) => a,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            for i in 0..archive.len() {
                let mut zf = match archive.by_index(i) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if zf.is_dir() {
                    continue;
                }
                let zbase = basename(zf.name());
                let key = zbase.to_lowercase();
                if !(key.ends_with(".lua") || key.ends_with(".manifest")) {
                    continue;
                }
                if !seen.insert(key) {
                    continue;
                }
                let mut buf = Vec::new();
                if zf.read_to_end(&mut buf).is_err() {
                    continue;
                }
                let _ = app.emit("install-progress", format!("Installing {}…", zbase));
                if let Some(entry) = route(&dest, &zbase, &buf) {
                    entries.push(entry);
                }
            }
        } else if lower.ends_with(".lua") || lower.ends_with(".manifest") {
            if !seen.insert(lower.clone()) {
                continue;
            }
            let _ = app.emit("install-progress", format!("Installing {}…", base));
            if let Some(entry) = route(&dest, &base, data) {
                entries.push(entry);
            }
        } else {
            skipped += 1;
        }
    }

    let lua_count = entries
        .iter()
        .filter(|e| e.kind == "lua" && e.status != "failed")
        .count() as u32;
    let manifest_count = entries
        .iter()
        .filter(|e| e.kind == "manifest" && e.status != "failed")
        .count() as u32;
    let mut app_ids: Vec<u32> = entries.iter().filter_map(|e| e.app_id).collect();
    app_ids.sort_unstable();
    app_ids.dedup();

    Ok(InstallReport {
        entries,
        lua_count,
        manifest_count,
        skipped,
        app_ids,
    })
}

#[tauri::command]
pub async fn install_manifest_paths(
    app: AppHandle,
    steam_path: String,
    paths: Vec<String>,
) -> Result<InstallReport, String> {
    let mut items: Vec<(String, Vec<u8>)> = Vec::new();
    let mut unread = 0u32;
    for path in &paths {
        let base = basename(path);
        let lower = base.to_lowercase();
        if lower.ends_with(".zip") || lower.ends_with(".lua") || lower.ends_with(".manifest") {
            match fs::read(Path::new(path)) {
                Ok(data) => items.push((base, data)),
                Err(_) => unread += 1,
            }
        } else {
            unread += 1;
        }
    }
    let mut report = build_report(&app, &steam_path, items)?;
    report.skipped += unread;
    Ok(report)
}

#[tauri::command]
pub async fn install_manifest_blob(
    app: AppHandle,
    steam_path: String,
    name: String,
    data: Vec<u8>,
) -> Result<InstallReport, String> {
    build_report(&app, &steam_path, vec![(name, data)])
}
