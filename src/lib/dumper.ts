import { invoke } from '@tauri-apps/api/core'

export interface LoginResult {
  via: string
  refresh_token: string
}

export interface StatusResult {
  logged_in: boolean
  steam_id: string | null
}

export interface OwnedGame {
  app_id: number
  name: string
  playtime: number
}

export interface SteamProfile {
  avatar_url: string | null
  persona_name: string | null
}

export interface DumpResult {
  app_id: number
  app_name: string
  output_dir: string
  depots_dumped: number
  depots_failed: number
  files: string[]
  errors: string[]
}

export function dumperLogin(args: {
  username?: string
  password?: string
  refreshToken?: string
}): Promise<LoginResult> {
  return invoke('dumper_login', args)
}

export function dumperSubmitGuard(code: string): Promise<void> {
  return invoke('dumper_submit_guard', { code })
}

export function dumperStatus(): Promise<StatusResult> {
  return invoke('dumper_status')
}

export function dumperLogout(): Promise<void> {
  return invoke('dumper_logout')
}

export function dumperOwnedGames(): Promise<{ games: OwnedGame[] }> {
  return invoke('dumper_owned_games')
}

export function dumperDumpApp(appId: number, outputDir?: string): Promise<DumpResult> {
  return invoke('dumper_dump_app', { appId, outputDir: outputDir ?? null })
}

export function dumperGetProfile(steamId: string): Promise<SteamProfile> {
  return invoke('dumper_get_profile', { steamId })
}
