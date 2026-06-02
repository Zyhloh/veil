import { invoke, convertFileSrc } from '@tauri-apps/api/core'

export function imageSrc(url: string): string {
  if (!url || url.startsWith('/') || url.startsWith('data:')) return url
  return convertFileSrc(url, 'veilimg')
}

export function pruneImageCache() {
  invoke('prune_image_cache').catch(() => {})
}
