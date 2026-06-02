import { invoke } from '@tauri-apps/api/core'

export interface InstallEntry {
  name: string
  kind: string
  app_id: number | null
  status: string
}

export interface InstallReport {
  entries: InstallEntry[]
  lua_count: number
  manifest_count: number
  skipped: number
  app_ids: number[]
}

export function installManifestPaths(steamPath: string, paths: string[]): Promise<InstallReport> {
  return invoke('install_manifest_paths', { steamPath, paths })
}
