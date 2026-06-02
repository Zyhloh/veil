use std::fs;

const TOOLS_BASE: &str = "https://app.projectveil.cc/tools";

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct ToolFile {
    pub name: String,
    pub size: u64,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn gs_list_tools() -> Result<Vec<ToolFile>, String> {
    let resp = client()?
        .get(TOOLS_BASE)
        .send()
        .await
        .map_err(|e| format!("tools list: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("tools list returned {}", resp.status()));
    }
    resp.json().await.map_err(|e| format!("tools list parse: {}", e))
}

#[tauri::command]
pub async fn gs_download_tool(name: String, dest: String) -> Result<String, String> {
    let url = format!("{}/{}", TOOLS_BASE, name);
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("download returned {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download read: {}", e))?;
    fs::write(&dest, &bytes).map_err(|e| format!("write: {}", e))?;
    Ok(dest)
}

#[tauri::command]
pub fn gs_installed_version() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-AppxPackage Microsoft.GamingServices).Version",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("version: {}", e))?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            return Ok(None);
        }
        return Ok(Some(s));
    }
    #[allow(unreachable_code)]
    Ok(None)
}

#[tauri::command]
pub fn gs_run_tool(path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new(&path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().map_err(|e| format!("run: {}", e))?;
    Ok(())
}
