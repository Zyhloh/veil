import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { FolderOpen, RotateCcw, Download } from 'lucide-react'

interface AppConfig {
  steam_path: string
  theme: string
  auto_restart_steam: boolean
  export_path: string
}

function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [steamPath, setSteamPath] = useState('')

  useEffect(() => {
    invoke<AppConfig>('get_app_config').then((cfg) => {
      setConfig(cfg)
    }).catch(() => {})

    invoke<string>('get_steam_path').then((path) => {
      setSteamPath(path)
    }).catch(() => setSteamPath('Not detected'))
  }, [])

  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <p className="text-text-muted text-xs mt-1">
          Configure Veil and manage Steam
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 overflow-y-auto"
      >
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Steam</h2>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">Steam Path</p>
                <p className="text-xs text-text-muted mt-0.5 font-mono">{steamPath || 'Detecting...'}</p>
              </div>
              <button className="p-2 rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border transition-colors duration-100">
                <FolderOpen size={14} className="text-text-muted" />
              </button>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">Auto-restart Steam</p>
                <p className="text-xs text-text-muted mt-0.5">Restart Steam after installing manifests</p>
              </div>
              <button
                onClick={() => {
                  if (config) {
                    const updated = { ...config, auto_restart_steam: !config.auto_restart_steam }
                    setConfig(updated)
                    invoke('save_app_config', { config: updated }).catch(() => {})
                  }
                }}
                className={`w-9 h-5 rounded-full transition-colors duration-200 flex items-center ${
                  config?.auto_restart_steam ? 'bg-white' : 'bg-accent-subtle'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full transition-all duration-200 mx-0.5 ${
                    config?.auto_restart_steam ? 'translate-x-4 bg-bg-primary' : 'translate-x-0 bg-text-muted'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Tools</h2>
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-2 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md transition-colors duration-100 text-xs text-text-secondary">
              <RotateCcw size={13} />
              Downgrade Steam
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md transition-colors duration-100 text-xs text-text-secondary">
              <Download size={13} />
              Install Resources
            </button>
          </div>
        </div>

        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Export</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Export Path</p>
              <p className="text-xs text-text-muted mt-0.5 font-mono">{config?.export_path || 'Not set'}</p>
            </div>
            <button className="p-2 rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border transition-colors duration-100">
              <FolderOpen size={14} className="text-text-muted" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default SettingsPage
