import { invoke } from '@tauri-apps/api/core'

export interface CatalogItem {
  app_id: number
  name: string
  header_url: string
}

export interface CatalogDetails {
  app_id: number
  name: string
  short_description: string
  header_image: string
  screenshots: string[]
  developers: string[]
  publishers: string[]
  genres: string[]
  release_date: string
  price: string
  is_free: boolean
  website: string
  dlc_app_ids: number[]
}

export function catalogTrending(): Promise<CatalogItem[]> {
  return invoke('catalog_trending')
}

export function catalogSearch(query: string): Promise<CatalogItem[]> {
  return invoke('catalog_search', { query })
}

export function catalogDetails(appId: number): Promise<CatalogDetails> {
  return invoke('catalog_details', { appId })
}

export interface CatalogVersion {
  sha: string
  short_sha: string
  date: string
  message: string
  build_id: string | null
}

export interface InstallStatus {
  app_id: number
  status: string
}

export interface SelectionResult {
  statuses: InstallStatus[]
  appended: number
}

export function catalogInstall(appId: number, steamPath: string): Promise<void> {
  return invoke('catalog_install', { appId, steamPath })
}

export function catalogInstallSelection(
  steamPath: string,
  mainAppId: number,
  installMain: boolean,
  dlcs: [number, string][],
): Promise<SelectionResult> {
  return invoke('catalog_install_selection', { steamPath, mainAppId, installMain, dlcs })
}

export function catalogInstallAt(appId: number, steamPath: string, commitSha: string): Promise<void> {
  return invoke('catalog_install_at', { appId, steamPath, commitSha })
}

export function catalogVersions(appId: number): Promise<CatalogVersion[]> {
  return invoke('catalog_list_versions', { appId })
}
