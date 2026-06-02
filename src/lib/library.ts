import { invoke } from '@tauri-apps/api/core'

export interface InstalledGame {
  app_id: string
  included_app_ids: number[]
  manifest_count: number
  install_dir: string | null
  launch_exe: string | null
}

export interface AppMeta {
  app_id: number
  name: string
  header_url: string
  kind: string
  parent_app_id: number
  dlc_app_ids: number[]
  released: boolean
}

export async function getSteamPath(): Promise<string> {
  const config = await invoke<{ steam_path: string }>('get_app_config')
  return config.steam_path
}

export function listInstalledGames(steamPath: string): Promise<InstalledGame[]> {
  return invoke('list_installed_games', { steamPath })
}

export function getAppsMeta(appIds: number[]): Promise<AppMeta[]> {
  if (appIds.length === 0) return Promise.resolve([])
  return invoke('get_apps_meta', { appIds })
}

export function removeManifest(steamPath: string, appId: string): Promise<void> {
  return invoke('remove_manifest', { steamPath, appId })
}

export function uninstallGame(steamPath: string, appId: string): Promise<void> {
  return invoke('uninstall_game', { steamPath, appId })
}

export function uninstallDlc(steamPath: string, mainAppId: number, dlcId: number): Promise<void> {
  return invoke('uninstall_dlc', { steamPath, mainAppId, dlcId })
}

export function launchWithSteam(appId: string): Promise<void> {
  return invoke('launch_game_steam', { appId: Number(appId) })
}

export function launchWithoutSteam(steamPath: string, appId: string): Promise<void> {
  return invoke('launch_game_direct', { steamPath, appId })
}

export function openFolder(path: string): Promise<void> {
  return invoke('open_folder', { path })
}

export function openUrl(url: string): Promise<void> {
  return invoke('open_url', { url })
}

export function headerSources(appId: string | number, primary?: string): string[] {
  const base = [
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`,
  ]
  return primary ? [primary, ...base] : base
}
