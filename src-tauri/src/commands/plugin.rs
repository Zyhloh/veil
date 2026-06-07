use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

// Luas are kept mirrored across both folders: the new system reads veil-plugin,
// while the older loader DLL still reads stplug-in.
const FOLDERS: [&str; 2] = ["veil-plugin", "stplug-in"];

pub fn dirs(steam_path: &str) -> [PathBuf; 2] {
    let cfg = Path::new(steam_path).join("config");
    [cfg.join(FOLDERS[0]), cfg.join(FOLDERS[1])]
}

fn unset_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

/// Delete a `<app_id>.lua` from every plugin folder.
pub fn remove_lua(steam_path: &str, app_id: &str) {
    let name = format!("{}.lua", app_id);
    for d in dirs(steam_path) {
        let p = d.join(&name);
        if p.exists() {
            unset_readonly(&p);
            let _ = fs::remove_file(&p);
        }
    }
}

/// Mirror luas so both folders hold the union, newest copy winning. Additive
/// only — deletions are handled at the delete sites so nothing is resurrected.
pub fn sync(steam_path: &str) {
    let ds = dirs(steam_path);
    for d in &ds {
        let _ = fs::create_dir_all(d);
    }

    let mut newest: HashMap<String, (PathBuf, SystemTime)> = HashMap::new();
    for d in &ds {
        let Ok(entries) = fs::read_dir(d) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("lua")) != Some(true) {
                continue;
            }
            let Some(name) = p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else { continue };
            let m = entry.metadata().and_then(|md| md.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            newest
                .entry(name)
                .and_modify(|cur| {
                    if m > cur.1 {
                        *cur = (p.clone(), m)
                    }
                })
                .or_insert((p, m));
        }
    }

    for (name, (src, _)) in &newest {
        let Ok(data) = fs::read(src) else { continue };
        for d in &ds {
            let dest = d.join(name);
            let differs = match fs::read(&dest) {
                Ok(cur) => cur != data,
                Err(_) => true,
            };
            if differs {
                unset_readonly(&dest);
                let _ = fs::write(&dest, &data);
            }
        }
    }
}

#[tauri::command]
pub fn sync_plugins(steam_path: String) -> Result<(), String> {
    if steam_path.is_empty() {
        return Ok(());
    }
    sync(&steam_path);
    Ok(())
}
