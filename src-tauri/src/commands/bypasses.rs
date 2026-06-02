use regex::Regex;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(serde::Deserialize, Clone)]
pub struct BypassFile {
    pub name: String,
    pub sha256: String,
}

#[derive(serde::Serialize)]
pub struct BypassCheckResult {
    pub state: String,
    pub install_dir: Option<String>,
    pub matched: u32,
    pub total: u32,
    pub actual_build: Option<String>,
    pub required_build: Option<String>,
}

const BYPASS_DOWNLOAD_BASE: &str = "https://app.projectveil.cc/bypasses";
const BYPASS_INFO_URL: &str = "https://app.projectveil.cc/bypasses/info";
const PROGRESS_EVENT: &str = "bypass-progress";

#[tauri::command]
pub async fn bypass_info() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(BYPASS_INFO_URL)
        .send()
        .await
        .map_err(|e| format!("bypasses info: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("bypasses info returned {}", resp.status()));
    }
    resp.json().await.map_err(|e| format!("bypasses info parse: {}", e))
}

#[derive(serde::Serialize, Clone)]
struct BypassProgress {
    app_id: u32,
    phase: &'static str,
    current: u64,
    total: u64,
    label: Option<String>,
}

fn emit(app: &AppHandle, payload: BypassProgress) {
    let _ = app.emit(PROGRESS_EVENT, payload);
}

fn library_paths(steam_path: &str) -> Vec<PathBuf> {
    let mut libs = vec![PathBuf::from(steam_path)];
    let vdf = Path::new(steam_path).join("steamapps").join("libraryfolders.vdf");
    let Ok(content) = fs::read_to_string(&vdf) else { return libs };

    let re = Regex::new(r#""path"\s*"([^"]+)""#).unwrap();
    for cap in re.captures_iter(&content) {
        let raw = cap[1].replace("\\\\", "\\");
        let p = PathBuf::from(&raw);
        if !libs.iter().any(|l| l == &p) {
            libs.push(p);
        }
    }
    libs
}

fn dir_has_files(path: &Path) -> bool {
    fs::read_dir(path).map(|mut it| it.next().is_some()).unwrap_or(false)
}

fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

fn force_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    clear_readonly(path);
    match fs::write(path, data) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = fs::remove_file(path);
            fs::write(path, data)
        }
    }
}

fn is_access_denied(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33))
}

fn kill_processes_in_dir(install_dir: &Path) -> Vec<String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let canon = fs::canonicalize(install_dir).unwrap_or_else(|_| install_dir.to_path_buf());
    let mut killed = Vec::new();

    for (_pid, proc_) in sys.processes() {
        let Some(exe) = proc_.exe() else { continue };
        let exe_canon = fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
        if exe_canon.starts_with(&canon) {
            let name = proc_.name().to_string_lossy().to_string();
            if proc_.kill() {
                killed.push(name);
            }
        }
    }

    if !killed.is_empty() {
        std::thread::sleep(Duration::from_millis(400));
    }

    killed
}

struct InstallInfo {
    dir: PathBuf,
    build_id: Option<String>,
}

fn find_install_info(steam_path: &str, app_id: u32) -> Option<InstallInfo> {
    let manifest_name = format!("appmanifest_{}.acf", app_id);
    let install_dir_re = Regex::new(r#""installdir"\s*"([^"]+)""#).ok()?;
    let state_flags_re = Regex::new(r#""StateFlags"\s*"(\d+)""#).ok()?;
    let bytes_dl_re = Regex::new(r#""BytesDownloaded"\s*"(\d+)""#).ok()?;
    let bytes_total_re = Regex::new(r#""BytesToDownload"\s*"(\d+)""#).ok()?;
    let build_id_re = Regex::new(r#""buildid"\s*"(\d+)""#).ok()?;

    for lib in library_paths(steam_path) {
        let manifest_path = lib.join("steamapps").join(&manifest_name);
        let Ok(content) = fs::read_to_string(&manifest_path) else { continue };

        let flags: u64 = state_flags_re
            .captures(&content)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        if flags != 4 {
            continue;
        }

        if let (Some(dl), Some(total)) = (
            bytes_dl_re.captures(&content).and_then(|c| c[1].parse::<u64>().ok()),
            bytes_total_re.captures(&content).and_then(|c| c[1].parse::<u64>().ok()),
        ) {
            if total > 0 && dl < total {
                continue;
            }
        }

        let Some(cap) = install_dir_re.captures(&content) else { continue };
        let full = lib.join("steamapps").join("common").join(&cap[1]);
        if full.exists() && dir_has_files(&full) {
            let build_id = build_id_re.captures(&content).map(|c| c[1].to_string());
            return Some(InstallInfo { dir: full, build_id });
        }
    }
    None
}

fn find_install_dir(steam_path: &str, app_id: u32) -> Option<PathBuf> {
    find_install_info(steam_path, app_id).map(|i| i.dir)
}

fn hash_file(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, &bytes);
    Some(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn resolve_dir(steam_path: &str, app_id: u32, override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path {
        if !p.is_empty() {
            let pb = PathBuf::from(p);
            return if pb.exists() { Some(pb) } else { None };
        }
    }
    find_install_dir(steam_path, app_id)
}

#[tauri::command]
pub fn bypass_check(
    steam_path: String,
    app_id: u32,
    files: Vec<BypassFile>,
    override_path: Option<String>,
    required_build: Option<String>,
) -> BypassCheckResult {
    let total = files.len() as u32;
    let required_build = required_build.filter(|s| !s.is_empty());

    let using_override = override_path.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    let install_info = if using_override {
        None
    } else {
        find_install_info(&steam_path, app_id)
    };
    let actual_build = install_info.as_ref().and_then(|i| i.build_id.clone());

    let Some(dir) = resolve_dir(&steam_path, app_id, override_path.as_deref()) else {
        return BypassCheckResult {
            state: "not_installed".into(),
            install_dir: None,
            matched: 0,
            total,
            actual_build,
            required_build,
        };
    };

    let mut matched = 0u32;
    for f in &files {
        let path = dir.join(&f.name);
        if let Some(actual) = hash_file(&path) {
            if actual.eq_ignore_ascii_case(&f.sha256) {
                matched += 1;
            }
        }
    }

    let hashes_match = total > 0 && matched == total;

    let version_mismatch = !using_override
        && required_build.is_some()
        && actual_build.is_some()
        && required_build.as_deref() != actual_build.as_deref();

    let state = if hashes_match {
        "installed"
    } else if version_mismatch {
        "wrong_version"
    } else {
        "available"
    };

    BypassCheckResult {
        state: state.into(),
        install_dir: Some(dir.to_string_lossy().to_string()),
        matched,
        total,
        actual_build,
        required_build,
    }
}

#[tauri::command]
pub async fn bypass_install(
    app: AppHandle,
    steam_path: String,
    app_id: u32,
    override_path: Option<String>,
    required_build: Option<String>,
) -> Result<String, String> {
    let using_override = override_path.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    let required_build = required_build.filter(|s| !s.is_empty());

    if !using_override {
        if let (Some(required), Some(info)) =
            (required_build.as_deref(), find_install_info(&steam_path, app_id))
        {
            if let Some(actual) = info.build_id.as_deref() {
                if actual != required {
                    return Err(format!(
                        "Game build does not match. This bypass requires build {}, but build {} is installed. Update the game in Steam and try again.",
                        required, actual
                    ));
                }
            }
        }
    }

    let install_dir = resolve_dir(&steam_path, app_id, override_path.as_deref()).ok_or_else(|| {
        if using_override {
            "Manual path does not exist or is not accessible".to_string()
        } else {
            format!("App {} is not installed in any Steam library", app_id)
        }
    })?;

    emit(&app, BypassProgress {
        app_id,
        phase: "download",
        current: 0,
        total: 0,
        label: Some("Connecting…".into()),
    });

    let url = format!("{}/{}", BYPASS_DOWNLOAD_BASE, app_id);
    let client = reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut resp = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download failed: {}", e))?;

    let total: u64 = resp.content_length().unwrap_or(0);
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last_emit = Instant::now();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Read response failed: {}", e))? {
        buf.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 80 {
            emit(&app, BypassProgress {
                app_id,
                phase: "download",
                current: downloaded,
                total,
                label: None,
            });
            last_emit = Instant::now();
        }
    }

    emit(&app, BypassProgress {
        app_id,
        phase: "download",
        current: downloaded,
        total: total.max(downloaded),
        label: None,
    });

    if buf.is_empty() {
        return Err("Empty bypass archive".into());
    }

    let reader = std::io::Cursor::new(buf);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Invalid zip: {}", e))?;

    let total_entries = archive.len() as u64;

    emit(&app, BypassProgress {
        app_id,
        phase: "extract",
        current: 0,
        total: total_entries,
        label: Some("Closing game processes…".into()),
    });
    let killed = kill_processes_in_dir(&install_dir);
    let killed_label = if killed.is_empty() {
        "Extracting files…".to_string()
    } else {
        format!("Closed {}", killed.join(", "))
    };

    emit(&app, BypassProgress {
        app_id,
        phase: "extract",
        current: 0,
        total: total_entries,
        label: Some(killed_label),
    });

    let mut extracted = 0u32;
    let mut last_emit = Instant::now();
    let mut retried_kill = false;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Zip entry error: {}", e))?;

        let Some(rel) = entry.enclosed_name() else { continue };
        let rel = rel.to_path_buf();
        let dest = install_dir.join(&rel);

        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
            }

            let mut data = Vec::with_capacity(entry.size() as usize);
            std::io::Read::read_to_end(&mut entry, &mut data)
                .map_err(|e| format!("Read entry failed: {}", e))?;

            match force_write(&dest, &data) {
                Ok(()) => {}
                Err(e) if is_access_denied(&e) => {
                    if !retried_kill {
                        retried_kill = true;
                        emit(&app, BypassProgress {
                            app_id,
                            phase: "extract",
                            current: (i + 1) as u64,
                            total: total_entries,
                            label: Some("File locked — closing blockers…".into()),
                        });
                        kill_processes_in_dir(&install_dir);
                        if let Err(e2) = force_write(&dest, &data) {
                            return Err(if is_access_denied(&e2) {
                                format!(
                                    "Access denied writing {}. Close the game or run Veil as Administrator.",
                                    rel.display()
                                )
                            } else {
                                format!("Write {} failed: {}", dest.display(), e2)
                            });
                        }
                    } else {
                        return Err(format!(
                            "Access denied writing {}. Close the game or run Veil as Administrator.",
                            rel.display()
                        ));
                    }
                }
                Err(e) => return Err(format!("Write {} failed: {}", dest.display(), e)),
            }
            extracted += 1;
        }

        if last_emit.elapsed().as_millis() >= 60 || (i + 1) as u64 == total_entries {
            emit(&app, BypassProgress {
                app_id,
                phase: "extract",
                current: (i + 1) as u64,
                total: total_entries,
                label: Some(rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()),
            });
            last_emit = Instant::now();
        }
    }

    emit(&app, BypassProgress {
        app_id,
        phase: "done",
        current: total_entries,
        total: total_entries,
        label: None,
    });

    Ok(format!("Installed {} file(s) to {}", extracted, install_dir.display()))
}

#[derive(serde::Serialize)]
pub struct BypassRemoveResult {
    pub removed: u32,
    pub skipped: u32,
}

#[tauri::command]
pub fn bypass_remove(
    steam_path: String,
    app_id: u32,
    files: Vec<BypassFile>,
    override_path: Option<String>,
) -> Result<BypassRemoveResult, String> {
    let install_dir = resolve_dir(&steam_path, app_id, override_path.as_deref())
        .ok_or_else(|| format!("Install dir not found for app {}", app_id))?;

    let _ = kill_processes_in_dir(&install_dir);

    let mut removed = 0u32;
    let mut skipped = 0u32;

    for f in &files {
        let path = install_dir.join(&f.name);
        let Some(actual) = hash_file(&path) else {
            continue;
        };
        if !actual.eq_ignore_ascii_case(&f.sha256) {
            skipped += 1;
            continue;
        }
        clear_readonly(&path);
        match fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(e) if is_access_denied(&e) => {
                kill_processes_in_dir(&install_dir);
                if fs::remove_file(&path).is_ok() {
                    removed += 1;
                } else {
                    return Err(format!(
                        "Access denied removing {}. Close the game or run Veil as Administrator.",
                        f.name
                    ));
                }
            }
            Err(e) => return Err(format!("Remove {} failed: {}", f.name, e)),
        }
    }

    Ok(BypassRemoveResult { removed, skipped })
}

fn match_close_brace(s: &str, open_pos: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if open_pos >= bytes.len() || bytes[open_pos] != b'{' {
        return None;
    }
    let mut depth = 1;
    let mut i = open_pos + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_child_section(content: &str, search_start: usize, search_end: usize, key: &str) -> Option<(usize, usize)> {
    let end = search_end.min(content.len());
    if search_start >= end {
        return None;
    }
    let region = &content[search_start..end];
    let lower_region = region.to_ascii_lowercase();
    let needle = format!("\"{}\"", key.to_ascii_lowercase());
    let mut cursor = 0;
    while let Some(rel) = lower_region[cursor..].find(&needle) {
        let key_pos = search_start + cursor + rel;
        let after_key = key_pos + needle.len();
        let tail = &content[after_key..end];
        if let Some(non_ws) = tail.find(|c: char| !c.is_whitespace() && c != '\r' && c != '\n') {
            let brace_pos = after_key + non_ws;
            if content.as_bytes()[brace_pos] == b'{' {
                if let Some(close) = match_close_brace(content, brace_pos) {
                    return Some((brace_pos, close));
                }
            }
        }
        cursor += rel + needle.len();
    }
    None
}

fn update_launch_options_in_vdf(path: &Path, app_id: u32, launch_options: &str) -> Result<bool, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("read {}: {}", path.display(), e))?;

    let len = content.len();
    let (sw_open, sw_close) = find_child_section(&content, 0, len, "Software")
        .ok_or_else(|| "No Software section in localconfig.vdf".to_string())?;
    let (valve_open, valve_close) = find_child_section(&content, sw_open + 1, sw_close, "Valve")
        .or_else(|| find_child_section(&content, sw_open + 1, sw_close, "valve software"))
        .ok_or_else(|| "No Valve section in localconfig.vdf".to_string())?;
    let (steam_open, steam_close) = find_child_section(&content, valve_open + 1, valve_close, "Steam")
        .ok_or_else(|| "No Steam section in localconfig.vdf".to_string())?;
    let (apps_open, apps_close) = find_child_section(&content, steam_open + 1, steam_close, "Apps")
        .ok_or_else(|| "No Apps section in localconfig.vdf".to_string())?;

    let apps_section = &content[apps_open + 1..apps_close];
    let key_pattern = format!("\"{}\"", app_id);
    let Some(key_rel) = apps_section.find(&key_pattern) else {
        return Ok(false);
    };
    let key_abs = apps_open + 1 + key_rel;

    let after_key = &content[key_abs + key_pattern.len()..];
    let block_open = after_key
        .find('{')
        .map(|p| key_abs + key_pattern.len() + p)
        .ok_or_else(|| "Malformed app block".to_string())?;
    let block_close = match_close_brace(&content, block_open)
        .ok_or_else(|| "Unmatched braces in app block".to_string())?;

    let inner = &content[block_open + 1..block_close];

    let escaped = launch_options.replace('\\', "\\\\").replace('"', "\\\"");

    let indent: String = inner
        .lines()
        .find_map(|l| {
            let trimmed = l.trim_start_matches(|c: char| c == ' ' || c == '\t');
            if trimmed.starts_with('"') {
                Some(l[..l.len() - trimmed.len()].to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "\t\t\t\t\t\t".to_string());

    let new_line = format!("{}\"LaunchOptions\"\t\t\"{}\"", indent, escaped);

    let lo_re = Regex::new(r#"(?m)^[ \t]*"LaunchOptions"[ \t]+"(?:[^"\\]|\\.)*"[ \t]*$"#)
        .map_err(|e| e.to_string())?;

    let new_inner = if lo_re.is_match(inner) {
        lo_re.replace(inner, new_line.as_str()).to_string()
    } else {
        let close_indent: String = {
            let prefix = &content[..block_close];
            let line_start = prefix.rfind('\n').map(|p| p + 1).unwrap_or(0);
            content[line_start..block_close]
                .chars()
                .take_while(|c| *c == ' ' || *c == '\t')
                .collect()
        };
        let trimmed = inner.trim_end_matches(|c: char| c == ' ' || c == '\t' || c == '\n' || c == '\r');
        format!("{}\n{}\n{}", trimmed, new_line, close_indent)
    };

    let mut out = String::with_capacity(content.len() + new_inner.len() + 64);
    out.push_str(&content[..block_open + 1]);
    out.push_str(&new_inner);
    out.push_str(&content[block_close..]);

    clear_readonly(path);
    fs::write(path, out).map_err(|e| format!("write {}: {}", path.display(), e))?;

    Ok(true)
}

fn resolve_launch_args(launch_options: &str, steam_path: &str) -> String {
    let normalized = steam_path.replace('/', "\\");
    let trimmed = normalized.trim_end_matches('\\');
    let re = Regex::new(r"(?i)%steampath%").unwrap();
    re.replace_all(launch_options, regex::NoExpand(trimmed)).to_string()
}

#[tauri::command]
pub fn bypass_set_launch_options(
    steam_path: String,
    app_id: u32,
    launch_options: String,
) -> Result<u32, String> {
    let resolved = resolve_launch_args(&launch_options, &steam_path);
    let userdata = Path::new(&steam_path).join("userdata");
    let entries =
        fs::read_dir(&userdata).map_err(|e| format!("userdata not found at {}: {}", userdata.display(), e))?;

    let mut updated = 0u32;
    let mut last_err: Option<String> = None;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "0" || name_str == "anonymous" {
            continue;
        }
        let cfg_path = entry.path().join("config").join("localconfig.vdf");
        if !cfg_path.exists() {
            continue;
        }
        match update_launch_options_in_vdf(&cfg_path, app_id, &resolved) {
            Ok(true) => updated += 1,
            Ok(false) => {}
            Err(e) => last_err = Some(e),
        }
    }

    if updated == 0 {
        return Err(last_err.unwrap_or_else(|| {
            format!(
                "App {} not found in any Steam account's localconfig.vdf. Launch the game in Steam at least once, then retry.",
                app_id
            )
        }));
    }

    Ok(updated)
}
