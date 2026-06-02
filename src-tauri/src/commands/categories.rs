use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const VEIL_CATEGORY_ID: &str = "uc-VeilCategory";
const VEIL_CATEGORY_NAME: &str = "Veil";

#[derive(Serialize, Default, Clone)]
pub struct CategorySyncResult {
    pub users_updated: u32,
    pub users_skipped: u32,
    pub users_repaired: u32,
    pub apps_in_category: u32,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn list_user_ids(steam_path: &Path) -> Vec<String> {
    let userdata = steam_path.join("userdata");
    let mut out = Vec::new();
    let entries = match fs::read_dir(&userdata) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "0" || name == "anonymous" {
            continue;
        }
        if name.chars().all(|c| c.is_ascii_digit()) && !name.is_empty() {
            out.push(name);
        }
    }
    out
}

fn collect_installed_app_ids(steam_path: &Path) -> Vec<u64> {
    let stplugin = steam_path.join("config").join("stplug-in");
    let mut ids = Vec::new();
    let entries = match fs::read_dir(&stplugin) {
        Ok(e) => e,
        Err(_) => return ids,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "lua").unwrap_or(false) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if let Ok(id) = stem.parse::<u64>() {
                    ids.push(id);
                }
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn namespace_path(steam_path: &Path, user_id: &str) -> PathBuf {
    steam_path
        .join("userdata")
        .join(user_id)
        .join("config")
        .join("cloudstorage")
        .join("cloud-storage-namespace-1.json")
}

fn parse_namespace(raw: &str) -> Option<Vec<(String, Value)>> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let arr = v.as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for pair in arr {
        let pa = pair.as_array()?;
        if pa.len() != 2 {
            return None;
        }
        let key = pa[0].as_str()?.to_string();
        out.push((key, pa[1].clone()));
    }
    Some(out)
}

fn serialize_namespace(entries: &[(String, Value)]) -> String {
    let arr: Vec<Value> = entries
        .iter()
        .map(|(k, v)| json!([k, v]))
        .collect();
    serde_json::to_string(&Value::Array(arr)).unwrap_or_else(|_| "[]".to_string())
}

fn next_version(entries: &[(String, Value)]) -> u64 {
    let mut max = 0u64;
    for (_, v) in entries {
        if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
            if let Ok(n) = ver.parse::<u64>() {
                if n > max {
                    max = n;
                }
            }
        }
    }
    max + 1
}

fn find_veil_index(entries: &[(String, Value)]) -> Option<usize> {
    let target_key = format!("user-collections.{}", VEIL_CATEGORY_ID);
    for (i, (k, v)) in entries.iter().enumerate() {
        if k == &target_key {
            return Some(i);
        }
        if !k.starts_with("user-collections.") {
            continue;
        }
        let val_str = match v.get("value").and_then(|x| x.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let inner: Value = match serde_json::from_str(val_str) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(name) = inner.get("name").and_then(|x| x.as_str()) {
            if name.eq_ignore_ascii_case(VEIL_CATEGORY_NAME) {
                return Some(i);
            }
        }
    }
    None
}

fn build_value_blob(app_ids: &[u64]) -> String {
    let inner = json!({
        "id": VEIL_CATEGORY_ID,
        "name": VEIL_CATEGORY_NAME,
        "added": app_ids,
        "removed": [],
    });
    serde_json::to_string(&inner).unwrap_or_else(|_| "{}".to_string())
}

fn build_entry(app_ids: &[u64], version: u64, timestamp: u64) -> (String, Value) {
    let key = format!("user-collections.{}", VEIL_CATEGORY_ID);
    let entry = json!({
        "key": key,
        "timestamp": timestamp,
        "value": build_value_blob(app_ids),
        "version": version.to_string(),
        "conflictResolutionMethod": "custom",
        "strMethodId": "union-collections",
    });
    (key, entry)
}

fn current_added_ids(entry: &Value) -> Vec<u64> {
    let s = match entry.get("value").and_then(|x| x.as_str()) {
        Some(s) => s,
        None => return Vec::new(),
    };
    let inner: Value = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    inner
        .get("added")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64())
                .collect::<Vec<u64>>()
        })
        .unwrap_or_default()
}

fn minimal_scaffold() -> Vec<(String, Value)> {
    let ts = now_secs();
    let fav_val = json!({
        "id": "favorite",
        "name": "Favorites",
        "added": [],
        "removed": [],
    });
    let hid_val = json!({
        "id": "hidden",
        "name": "Hidden",
        "added": [],
        "removed": [],
    });
    vec![
        (
            "user-collections.favorite".to_string(),
            json!({
                "key": "user-collections.favorite",
                "timestamp": ts,
                "value": serde_json::to_string(&fav_val).unwrap_or_default(),
                "version": "1",
            }),
        ),
        (
            "user-collections.hidden".to_string(),
            json!({
                "key": "user-collections.hidden",
                "timestamp": ts,
                "value": serde_json::to_string(&hid_val).unwrap_or_default(),
                "version": "1",
            }),
        ),
        (
            "collection-bootstrap-complete".to_string(),
            json!({
                "key": "collection-bootstrap-complete",
                "timestamp": ts,
                "value": "true",
                "version": "1",
            }),
        ),
        (
            "sc-version".to_string(),
            json!({
                "key": "sc-version",
                "timestamp": ts,
                "value": "6",
                "version": "1",
            }),
        ),
    ]
}

#[derive(Clone, Copy, PartialEq)]
enum LoadKind {
    Primary,
    Backup,
    Scaffold,
}

fn load_entries_with_recovery(path: &Path) -> (Vec<(String, Value)>, LoadKind) {
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Some(entries) = parse_namespace(&raw) {
                return (entries, LoadKind::Primary);
            }
        }
    }
    let bak = path.with_extension("json.bak");
    if bak.exists() {
        if let Ok(raw) = fs::read_to_string(&bak) {
            if let Some(entries) = parse_namespace(&raw) {
                return (entries, LoadKind::Backup);
            }
        }
    }
    (minimal_scaffold(), LoadKind::Scaffold)
}

fn atomic_write(path: &Path, data: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data)
        .map_err(|e| format!("write tmp {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, path)
        .map_err(|e| format!("rename {}: {}", path.display(), e))
}

fn sync_user(
    steam_path: &Path,
    user_id: &str,
    app_ids: &[u64],
) -> Result<(bool, bool), String> {
    let path = namespace_path(steam_path, user_id);
    let tmp_leftover = path.with_extension("json.tmp");
    if tmp_leftover.exists() {
        let _ = fs::remove_file(&tmp_leftover);
    }

    if !path.exists() && !path.with_extension("json.bak").exists() {
        return Ok((false, false));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }

    let (mut entries, kind) = load_entries_with_recovery(&path);
    let repaired = kind != LoadKind::Primary;

    let idx = find_veil_index(&entries);
    let mut desired: Vec<u64> = app_ids.to_vec();
    desired.sort_unstable();
    desired.dedup();

    if !repaired && idx.is_none() && desired.is_empty() {
        return Ok((false, false));
    }

    if !repaired {
        if let Some(i) = idx {
            let mut existing = current_added_ids(&entries[i].1);
            existing.sort_unstable();
            existing.dedup();
            if existing == desired {
                return Ok((false, false));
            }
        }
    }

    let version = next_version(&entries);
    let new_entry = build_entry(&desired, version, now_secs());

    match idx {
        Some(i) => entries[i] = new_entry,
        None => entries.push(new_entry),
    }

    if path.exists() && kind == LoadKind::Primary {
        let bak = path.with_extension("json.bak");
        let _ = fs::copy(&path, &bak);
    }

    let serialized = serialize_namespace(&entries);
    atomic_write(&path, &serialized)?;

    Ok((true, repaired))
}

fn user_needs_sync(steam_path: &Path, user_id: &str, app_ids: &[u64]) -> bool {
    let path = namespace_path(steam_path, user_id);
    let tmp_leftover = path.with_extension("json.tmp");
    if tmp_leftover.exists() {
        return true;
    }
    if !path.exists() {
        return false;
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let entries = match parse_namespace(&raw) {
        Some(e) => e,
        None => return true,
    };
    let idx = find_veil_index(&entries);
    let mut desired: Vec<u64> = app_ids.to_vec();
    desired.sort_unstable();
    desired.dedup();
    match idx {
        None => !desired.is_empty(),
        Some(i) => {
            let mut existing = current_added_ids(&entries[i].1);
            existing.sort_unstable();
            existing.dedup();
            existing != desired
        }
    }
}

#[tauri::command]
pub fn veil_category_needs_sync(steam_path: String) -> Result<bool, String> {
    let sp = PathBuf::from(&steam_path);
    if !sp.exists() {
        return Ok(false);
    }
    let app_ids = collect_installed_app_ids(&sp);
    for uid in list_user_ids(&sp) {
        if user_needs_sync(&sp, &uid, &app_ids) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn sync_veil_category(steam_path: String) -> Result<CategorySyncResult, String> {
    let sp = PathBuf::from(&steam_path);
    if !sp.exists() {
        return Err(format!("steam path does not exist: {}", steam_path));
    }

    let app_ids = collect_installed_app_ids(&sp);
    let users = list_user_ids(&sp);

    let mut result = CategorySyncResult {
        users_updated: 0,
        users_skipped: 0,
        users_repaired: 0,
        apps_in_category: app_ids.len() as u32,
    };

    if users.is_empty() {
        return Ok(result);
    }

    for uid in users {
        match sync_user(&sp, &uid, &app_ids) {
            Ok((true, repaired)) => {
                result.users_updated += 1;
                if repaired {
                    result.users_repaired += 1;
                }
            }
            Ok((false, _)) => result.users_skipped += 1,
            Err(_) => result.users_skipped += 1,
        }
    }

    Ok(result)
}

fn remove_user_category(steam_path: &Path, user_id: &str) -> Result<bool, String> {
    let path = namespace_path(steam_path, user_id);
    if !path.exists() {
        return Ok(false);
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(false),
    };
    let mut entries = match parse_namespace(&raw) {
        Some(e) => e,
        None => return Ok(false),
    };
    let idx = match find_veil_index(&entries) {
        Some(i) => i,
        None => return Ok(false),
    };
    entries.remove(idx);

    let bak = path.with_extension("json.bak");
    let _ = fs::copy(&path, &bak);
    atomic_write(&path, &serialize_namespace(&entries))?;
    Ok(true)
}

#[tauri::command]
pub fn remove_veil_category(steam_path: String) -> Result<CategorySyncResult, String> {
    let sp = PathBuf::from(&steam_path);
    let mut result = CategorySyncResult::default();
    for uid in list_user_ids(&sp) {
        match remove_user_category(&sp, &uid) {
            Ok(true) => result.users_updated += 1,
            _ => result.users_skipped += 1,
        }
    }
    Ok(result)
}
