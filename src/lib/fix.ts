import { invoke } from '@tauri-apps/api/core'

export interface FixResult {
  apps_checked: number
  updated: number
  skipped: number
  failed: number
}

export function fixLibraryManifests(steamPath: string, force: boolean): Promise<FixResult> {
  return invoke('fix_library_manifests', { steamPath, force })
}
