import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { FolderOpen } from 'lucide-react'

interface AppConfig {
  steam_path: string
  veil_enabled: boolean
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [dllStatus, setDllStatus] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const cfg = await invoke<AppConfig>('get_app_config')
        if (!cfg.steam_path) {
          try {
            const detected = await invoke<string>('get_steam_path')
            cfg.steam_path = detected
            await invoke('save_app_config', { config: cfg })
          } catch {}
        }
        setConfig(cfg)
      } catch {}
    }
    load()
  }, [])

  const toggleVeil = async () => {
    if (!config) return
    const newEnabled = !config.veil_enabled
    const updated = { ...config, veil_enabled: newEnabled }
    setConfig(updated)
    await invoke('save_app_config', { config: updated }).catch(() => {})

    if (newEnabled && config.steam_path) {
      setDllStatus('Installing...')
      try {
        const result = await invoke<string>('ensure_veil_dll', { steamPath: config.steam_path })
        setDllStatus(result === 'already_installed' ? '' : 'Installed')
        setTimeout(() => setDllStatus(''), 2000)
      } catch (e) {
        setDllStatus('Error')
      }
    } else if (!newEnabled && config.steam_path) {
      setDllStatus('Removing...')
      try {
        await invoke<string>('remove_veil_dll', { steamPath: config.steam_path })
        setDllStatus('Removed')
        setTimeout(() => setDllStatus(''), 2000)
      } catch (e) {
        setDllStatus('Error')
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-6"
      >
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">Settings</h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          Configure Veil and manage Steam
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
        className="flex flex-col gap-4 overflow-y-auto"
      >
        <div className="veil-card rounded-2xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-white/25 mb-4">Veil</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-white/90 font-medium">Enable Veil</p>
              <p className="text-[11px] text-white/30 mt-1">
                {dllStatus || 'Injects dwmapi.dll into Steam for manifest loading'}
              </p>
            </div>
            <button
              onClick={toggleVeil}
              className={`w-[38px] h-[22px] rounded-full transition-all duration-200 flex items-center px-[3px] ${
                config?.veil_enabled ? 'veil-toggle-on' : 'veil-toggle-off'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  config?.veil_enabled ? 'translate-x-[14px] bg-black' : 'translate-x-0 bg-white/40'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="veil-card rounded-2xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-white/25 mb-4">Steam</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-white/90 font-medium">Steam Path</p>
              <p className="text-[11px] text-white/30 mt-1 font-mono">{config?.steam_path || 'Detecting...'}</p>
            </div>
            <button className="veil-btn p-2.5 rounded-xl">
              <FolderOpen size={14} strokeWidth={1.5} className="text-white/40" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default SettingsPage
