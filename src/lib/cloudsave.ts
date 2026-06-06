import { invoke } from '@tauri-apps/api/core'

export interface CloudSavesStatus {
  enabled: boolean
  log_enabled: boolean
  sync_path: string
  steam_running: boolean
}

export function cloudSavesStatus(steamPath: string): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_status', { steamPath })
}

export function cloudSavesEnsure(steamPath: string): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_ensure', { steamPath })
}

export function cloudSavesEnable(steamPath: string, folder: string): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_enable', { steamPath, folder })
}

export function cloudSavesDisable(steamPath: string): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_disable', { steamPath })
}

export function cloudSavesSetFolder(steamPath: string, folder: string): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_set_folder', { steamPath, folder })
}

export function cloudSavesSetLogging(steamPath: string, enabled: boolean): Promise<CloudSavesStatus> {
  return invoke('cloud_saves_set_logging', { steamPath, enabled })
}

export function cloudSavesBackup(steamPath: string): Promise<string> {
  return invoke('cloud_saves_backup', { steamPath })
}

export function cloudSavesImport(steamPath: string, zipPath: string): Promise<number> {
  return invoke('cloud_saves_import', { steamPath, zipPath })
}
