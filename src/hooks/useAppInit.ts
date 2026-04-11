import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface AppConfig {
  steam_path: string
  veil_enabled: boolean
  patches_applied: boolean
}

interface VerifyResult {
  ok: boolean
  missing: number
  wrong_hash: number
  steam_running: boolean
}

const WATCHDOG_INTERVAL_MS = 4000

export function useAppInit() {
  const [showRestartModal, setShowRestartModal] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let busy = false

    async function init() {
      try {
        let config = await invoke<AppConfig>('get_app_config')

        if (!config.steam_path) {
          try {
            const detectedPath = await invoke<string>('get_steam_path')
            config = { ...config, steam_path: detectedPath }
            await invoke('save_app_config', { config })
          } catch {
            return
          }
        }

        if (config.veil_enabled && config.steam_path && !config.patches_applied) {
          const result = await invoke<string>('ensure_veil_dll', { steamPath: config.steam_path }).catch(() => 'error')
          if (result === 'installed' || result === 'repaired') {
            setShowRestartModal(true)
          }
        }
      } catch {}
    }

    async function tick() {
      if (cancelled || busy) return
      busy = true
      try {
        const config = await invoke<AppConfig>('get_app_config').catch(() => null)
        if (!config || !config.veil_enabled || !config.steam_path) return
        if (config.patches_applied) return

        const status = await invoke<VerifyResult>('verify_veil_dll', {
          steamPath: config.steam_path,
        }).catch(() => null)
        if (!status || status.ok) return

        const result = await invoke<string>('ensure_veil_dll', {
          steamPath: config.steam_path,
        }).catch(() => 'error')

        if (result === 'installed' || result === 'repaired') {
          setShowRestartModal(true)
        }
      } finally {
        busy = false
      }
    }

    init().then(() => {
      if (cancelled) return
      timer = setInterval(tick, WATCHDOG_INTERVAL_MS)
    })

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  return { showRestartModal, setShowRestartModal }
}
