import { invoke } from '@tauri-apps/api/core'

export interface AppConfig {
  steam_path: string
  dump_path: string
  veil_enabled: boolean
  patches_applied: boolean
}

export function getAppConfig(): Promise<AppConfig> {
  return invoke('get_app_config')
}

export function saveAppConfig(config: AppConfig): Promise<void> {
  return invoke('save_app_config', { config })
}

export function resolveDumpPath(): Promise<string> {
  return invoke('resolve_dump_path')
}

export interface VerifyResult {
  ok: boolean
  missing: number
  stale: number
  steam_running: boolean
}

export function ensureVeilDll(steamPath: string): Promise<string> {
  return invoke('ensure_veil_dll', { steamPath })
}

export function removeVeilDll(steamPath: string): Promise<string> {
  return invoke('remove_veil_dll', { steamPath })
}

export function verifyVeilDll(steamPath: string): Promise<VerifyResult> {
  return invoke('verify_veil_dll', { steamPath })
}

export interface ResetResult {
  deleted_entries: number
  failed_entries: number
  freed_bytes: number
  steam_started: boolean
  failures: string[]
}

export function resetSteamInstall(steamPath: string): Promise<ResetResult> {
  return invoke('reset_steam_install', { steamPath })
}

export interface UpdateInfo {
  available: boolean
  current_version: string
  latest_version: string
  download_url: string
  asset_name: string
  release_notes: string
  release_url: string
}

export function checkForUpdate(): Promise<UpdateInfo> {
  return invoke('check_for_update')
}

export function downloadAndRunUpdate(url: string): Promise<string> {
  return invoke('download_and_run_update', { url })
}
