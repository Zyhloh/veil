use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static MAIN_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn mark_main_ready() {
    MAIN_READY.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn is_main_ready() -> bool {
    MAIN_READY.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("No path provided".to_string());
    }
    Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("No url provided".to_string());
    }
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
