import { invoke } from '@tauri-apps/api/core'

export interface BypassFile {
  name: string
  sha256: string
}

export interface BypassInfo {
  AppID: number
  AppName: string
  LastUpdated: string
  RequiredBuild?: string
  LaunchArgs?: string
  Files: BypassFile[]
}

export type BypassState = 'installed' | 'available' | 'not_installed' | 'wrong_version'

export interface BypassCheckResult {
  state: BypassState
  install_dir: string | null
  matched: number
  total: number
  actual_build: string | null
  required_build: string | null
}

export interface BypassRemoveResult {
  removed: number
  skipped: number
}

export function fetchBypasses(): Promise<BypassInfo[]> {
  return invoke('bypass_info')
}

export function bypassCheck(
  steamPath: string,
  appId: number,
  files: BypassFile[],
  overridePath: string | null,
  requiredBuild: string | null,
): Promise<BypassCheckResult> {
  return invoke('bypass_check', { steamPath, appId, files, overridePath, requiredBuild })
}

export function bypassInstall(
  steamPath: string,
  appId: number,
  overridePath: string | null,
  requiredBuild: string | null,
): Promise<string> {
  return invoke('bypass_install', { steamPath, appId, overridePath, requiredBuild })
}

export function bypassRemove(
  steamPath: string,
  appId: number,
  files: BypassFile[],
  overridePath: string | null,
): Promise<BypassRemoveResult> {
  return invoke('bypass_remove', { steamPath, appId, files, overridePath })
}

export function bypassSetLaunchOptions(
  steamPath: string,
  appId: number,
  launchOptions: string,
): Promise<number> {
  return invoke('bypass_set_launch_options', { steamPath, appId, launchOptions })
}
