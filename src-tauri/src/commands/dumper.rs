// Steam manifest dumper — Rust side of the Node sidecar.
//
// The Node sidecar (`binaries/veil-dumper`) speaks line-delimited JSON over
// stdin/stdout. This module keeps one long-lived sidecar process alive and
// multiplexes requests onto it from Tauri commands, matching replies via
// monotonically increasing request ids.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

type Pending = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

struct DumperState {
    child: CommandChild,
    next_id: u64,
    pending: Pending,
}

static STATE: OnceLock<Arc<Mutex<Option<DumperState>>>> = OnceLock::new();

fn state() -> &'static Arc<Mutex<Option<DumperState>>> {
    STATE.get_or_init(|| Arc::new(Mutex::new(None)))
}

fn ensure_spawned(app: &AppHandle) -> Result<(), String> {
    {
        let guard = state().lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
    }

    let cmd = app
        .shell()
        .sidecar("veil-dumper")
        .map_err(|e| format!("Failed to resolve dumper sidecar: {}", e))?;

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn dumper sidecar: {}", e))?;

    {
        let mut guard = state().lock().unwrap();
        *guard = Some(DumperState {
            child,
            next_id: 1,
            pending: HashMap::new(),
        });
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    for l in line.split('\n') {
                        let trimmed = l.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        handle_line(&app_handle, trimmed);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let s = String::from_utf8_lossy(&bytes).to_string();
                    eprintln!("[dumper stderr] {}", s);
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[dumper] terminated: {:?}", payload);
                    let mut guard = state().lock().unwrap();
                    if let Some(mut st) = guard.take() {
                        for (_, tx) in st.pending.drain() {
                            let _ = tx.send(Err("Dumper sidecar terminated".into()));
                        }
                        let _ = st.child.kill();
                    }
                    let _ = app_handle.emit("dumper:terminated", ());
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("[dumper] error: {}", err);
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn handle_line(app: &AppHandle, line: &str) {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[dumper] bad JSON: {} — {}", e, line);
            return;
        }
    };

    // Reply: has numeric `id`.
    if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
        let mut guard = state().lock().unwrap();
        if let Some(st) = guard.as_mut() {
            if let Some(tx) = st.pending.remove(&id) {
                let ok = value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                let result = if ok {
                    Ok(value.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(value
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown dumper error")
                        .to_string())
                };
                let _ = tx.send(result);
                return;
            }
        }
    }

    // Event: has string `event`.
    if let Some(event_name) = value.get("event").and_then(|v| v.as_str()) {
        let full = format!("dumper:{}", event_name);
        let payload = value.clone();
        let _ = app.emit(&full, payload);
    }
}

async fn request(app: &AppHandle, cmd: &str, extra: Value) -> Result<Value, String> {
    ensure_spawned(app)?;

    let (tx, rx) = oneshot::channel();
    let id;
    let mut line;
    {
        let mut guard = state().lock().unwrap();
        let st = guard.as_mut().ok_or("Dumper not running")?;
        id = st.next_id;
        st.next_id += 1;
        st.pending.insert(id, tx);

        let mut obj = json!({ "id": id, "cmd": cmd });
        if let Value::Object(ref mut m) = obj {
            if let Value::Object(extra_map) = extra {
                for (k, v) in extra_map {
                    m.insert(k, v);
                }
            }
        }
        line = obj.to_string();
        line.push('\n');

        st.child
            .write(line.as_bytes())
            .map_err(|e| format!("Failed to write to dumper stdin: {}", e))?;
    }

    rx.await.map_err(|_| "Dumper reply channel closed".to_string())?
}

// -- Serializable reply structs -----------------------------------------------

#[derive(Serialize)]
pub struct LoginResult {
    pub via: String,
    pub refresh_token: String,
}

#[derive(Serialize)]
pub struct StatusResult {
    pub logged_in: bool,
    pub steam_id: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct OwnedGame {
    pub app_id: u32,
    pub name: String,
    pub playtime: u64,
}

#[derive(Serialize)]
pub struct OwnedGames {
    pub games: Vec<OwnedGame>,
}

#[derive(Serialize, Deserialize)]
pub struct DumpResult {
    pub app_id: u32,
    pub app_name: String,
    pub output_dir: String,
    pub depots_dumped: u32,
    pub depots_failed: u32,
    pub files: Vec<String>,
    pub errors: Vec<String>,
}

fn from_value<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("Bad dumper response: {}", e))
}

// -- Tauri commands -----------------------------------------------------------

#[tauri::command]
pub async fn dumper_login(
    app: AppHandle,
    username: Option<String>,
    password: Option<String>,
    refresh_token: Option<String>,
) -> Result<LoginResult, String> {
    let mut extra = serde_json::Map::new();
    if let Some(u) = username {
        extra.insert("username".into(), Value::String(u));
    }
    if let Some(p) = password {
        extra.insert("password".into(), Value::String(p));
    }
    if let Some(t) = refresh_token {
        extra.insert("refresh_token".into(), Value::String(t));
    }
    let data = request(&app, "login", Value::Object(extra)).await?;
    let via = data
        .get("via")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let refresh_token = data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(LoginResult { via, refresh_token })
}

#[tauri::command]
pub async fn dumper_submit_guard(app: AppHandle, code: String) -> Result<(), String> {
    request(&app, "submit_guard", json!({ "code": code })).await?;
    Ok(())
}

#[tauri::command]
pub async fn dumper_status(app: AppHandle) -> Result<StatusResult, String> {
    let data = request(&app, "status", json!({})).await?;
    Ok(StatusResult {
        logged_in: data
            .get("logged_in")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        steam_id: data
            .get("steam_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

#[tauri::command]
pub async fn dumper_logout(app: AppHandle) -> Result<(), String> {
    request(&app, "logout", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn dumper_owned_games(app: AppHandle) -> Result<OwnedGames, String> {
    let data = request(&app, "get_owned_games", json!({})).await?;
    let games: Vec<OwnedGame> = data
        .get("games")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|g| serde_json::from_value::<OwnedGame>(g.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    Ok(OwnedGames { games })
}

#[tauri::command]
pub async fn dumper_dump_app(
    app: AppHandle,
    app_id: u32,
    output_dir: Option<String>,
) -> Result<DumpResult, String> {
    // Default output: %USERPROFILE%/Documents/Veil Dumps/{app_id}
    let out_dir = match output_dir {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => {
            let base = app
                .path()
                .document_dir()
                .map_err(|e| format!("No documents dir: {}", e))?;
            base.join("Veil Dumps").join(app_id.to_string())
        }
    };
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let data = request(
        &app,
        "dump_app",
        json!({ "app_id": app_id, "output_dir": out_dir.to_string_lossy() }),
    )
    .await?;
    let result: DumpResult = from_value(data)?;

    // Open the folder in Explorer for the user.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("explorer.exe")
            .arg(&result.output_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    Ok(result)
}

#[derive(Serialize, Default)]
pub struct SteamProfile {
    pub avatar_url: Option<String>,
    pub persona_name: Option<String>,
}

fn extract_xml_tag(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = body.find(&open)? + open.len();
    let end = body[start..].find(&close)? + start;
    let inner = body[start..end].trim();
    let cleaned = inner
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .trim();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

#[tauri::command]
pub async fn dumper_get_profile(steam_id: String) -> Result<SteamProfile, String> {
    // Fetch the public Steam community profile XML and pull both avatar URL
    // and persona/display name out. Done from Rust to avoid CORS.
    let url = format!("https://steamcommunity.com/profiles/{}?xml=1", steam_id);
    let client = reqwest::Client::builder()
        .user_agent("Veil/1.0 (+https://github.com/Zyhloh/veil)")
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("profile fetch: {}", e))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("profile body: {}", e))?;

    Ok(SteamProfile {
        avatar_url: extract_xml_tag(&body, "avatarFull"),
        persona_name: extract_xml_tag(&body, "steamID"),
    })
}

#[tauri::command]
pub async fn dumper_shutdown() -> Result<(), String> {
    let mut guard = state().lock().unwrap();
    if let Some(mut st) = guard.take() {
        for (_, tx) in st.pending.drain() {
            let _ = tx.send(Err("Dumper shutting down".into()));
        }
        let _ = st.child.kill();
    }
    Ok(())
}
