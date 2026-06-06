import { invoke } from '@tauri-apps/api/core'

export interface OnlineFixEntry {
  status: 'available' | 'unavailable'
  url: string | null
  checked_at: number
}

export function onlineFixCached(appIds: number[]): Promise<Record<string, OnlineFixEntry>> {
  return invoke('online_fix_cached', { appIds })
}

export function onlineFixFetch(appId: number, name: string): Promise<OnlineFixEntry> {
  return invoke('online_fix_fetch', { appId, name })
}
