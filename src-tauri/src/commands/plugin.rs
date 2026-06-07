use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

// Installed luas are written to both folders: the loader DLL reads "Veil", and
// "stplug-in" is kept populated for compatibility. The DLL mirrors between them
// on startup, so the app only writes/deletes — it never compares or copies.
const FOLDERS: [&str; 2] = ["Veil", "stplug-in"];

pub fn dirs(steam_path: &str) -> [PathBuf; 2] {
    let cfg = Path::new(steam_path).join("config");
    [cfg.join(FOLDERS[0]), cfg.join(FOLDERS[1])]
}

/// The folder used for "open plugin folder" and as the primary loader folder.
pub fn primary_dir(steam_path: &str) -> PathBuf {
    Path::new(steam_path).join("config").join(FOLDERS[0])
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

/// Write a file by name into every plugin folder.
pub fn write_to_all(steam_path: &str, name: &str, data: &[u8]) -> std::io::Result<()> {
    let mut result = Ok(());
    for d in dirs(steam_path) {
        let _ = fs::create_dir_all(&d);
        let p = d.join(name);
        unset_readonly(&p);
        if let Err(e) = fs::write(&p, data) {
            result = Err(e);
        }
    }
    result
}

/// Delete `<app_id>.lua` from every plugin folder.
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

/// Read `<app_id>.lua` from whichever folder has it.
pub fn read_lua(steam_path: &str, app_id: &str) -> Option<String> {
    let name = format!("{}.lua", app_id);
    for d in dirs(steam_path) {
        if let Ok(c) = fs::read_to_string(d.join(&name)) {
            return Some(c);
        }
    }
    None
}

/// Distinct `*.lua` filenames present across all plugin folders.
pub fn lua_names(steam_path: &str) -> Vec<String> {
    let mut set = BTreeSet::new();
    for d in dirs(steam_path) {
        if let Ok(entries) = fs::read_dir(&d) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|x| x.to_str()) == Some("lua") {
                    if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
                        set.insert(n.to_string());
                    }
                }
            }
        }
    }
    set.into_iter().collect()
}
