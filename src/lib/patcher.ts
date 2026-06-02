import { invoke } from '@tauri-apps/api/core'

export type PatchState =
  | 'not_installed'
  | 'unpatched'
  | 'patched'
  | 'partially_patched'
  | 'out_of_date'
  | 'payload_corrupt'
  | 'unknown_version'

export interface PatcherDiagnostics {
  steam_path: string
  core_dll_name: string | null
  core_dll_state: PatchState
  capcom_state: PatchState
  offline_state: PatchState
  needs_dll_repair: boolean
  fingerprint: string
  cache_found: boolean
}

export interface PatchActionResult {
  succeeded: boolean
  dll_patched: boolean
  cache_patched: boolean
  message: string
}

export function patcherDiagnose(steamPath: string): Promise<PatcherDiagnostics> {
  return invoke('patcher_diagnose', { steamPath })
}

export function patcherApplyCapcom(steamPath: string): Promise<PatchActionResult> {
  return invoke('patcher_apply_capcom', { steamPath })
}

export function patcherApplyOffline(steamPath: string): Promise<PatchActionResult> {
  return invoke('patcher_apply_offline', { steamPath })
}

export function patcherRestore(steamPath: string): Promise<PatchActionResult> {
  return invoke('patcher_restore', { steamPath })
}
