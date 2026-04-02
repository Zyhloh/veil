import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface AppConfig {
  steam_path: string
  veil_enabled: boolean
}

export function useAppInit() {
  const [showRestartModal, setShowRestartModal] = useState(false)

  useEffect(() => {
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

        if (config.veil_enabled && config.steam_path) {
          const result = await invoke<string>('ensure_veil_dll', { steamPath: config.steam_path }).catch(() => 'error')
          if (result === 'installed') {
            setShowRestartModal(true)
          }
        }
      } catch {}
    }

    init()
  }, [])

  return { showRestartModal, setShowRestartModal }
}
