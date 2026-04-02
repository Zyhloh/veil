import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { Upload, FileArchive, CheckCircle, AlertCircle, AlertTriangle, FolderOpen } from 'lucide-react'

interface InstallResult {
  lua_count: number
  manifest_count: number
}

function isValidPath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.lua') || lower.endsWith('.manifest') || lower.endsWith('.zip')
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

function InstallPage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [needsRestart, setNeedsRestart] = useState(false)

  const getSteamPath = async (): Promise<string> => {
    const config = await invoke<{ steam_path: string }>('get_app_config')
    if (config.steam_path) return config.steam_path
    return await invoke<string>('get_steam_path')
  }

  const installFromPaths = useCallback(async (filePaths: string[]) => {
    const valid = filePaths.filter(isValidPath)
    if (valid.length === 0) {
      setStatus('error')
      setMessage('No valid .lua, .manifest, or .zip files found')
      setTimeout(() => { setStatus('idle'); setMessage('') }, 3000)
      return
    }

    setStatus('processing')
    try {
      const steamPath = await getSteamPath()
      const result = await invoke<InstallResult>('install_manifest_paths', {
        steamPath,
        paths: valid,
      })

      setMessage('Updating manifests...')
      await invoke('fix_all_manifests', { steamPath }).catch(() => {})

      setStatus('success')
      setMessage(`Installed ${result.lua_count} lua + ${result.manifest_count} manifest files`)
      setNeedsRestart(true)
      setTimeout(() => { setStatus('idle'); setMessage('') }, 4000)
    } catch (e: unknown) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
      setTimeout(() => { setStatus('idle'); setMessage('') }, 4000)
    }
  }, [])

  useEffect(() => {
    const webview = getCurrentWebview()
    const unlistenDrag = webview.onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setIsDragOver(true)
      } else if (event.payload.type === 'drop') {
        setIsDragOver(false)
        const paths = event.payload.paths
        if (paths.length > 0) installFromPaths(paths)
      } else if (event.payload.type === 'leave') {
        setIsDragOver(false)
      }
    })

    const unlistenProgress = listen<string>('fix-progress', (event) => {
      setMessage(event.payload)
    })

    return () => {
      unlistenDrag.then(fn => fn())
      unlistenProgress.then(fn => fn())
    }
  }, [installFromPaths])

  const handleBrowse = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Manifest Files', extensions: ['zip', 'lua', 'manifest'] }],
    })
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected]
      if (paths.length > 0) installFromPaths(paths)
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
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">Install Manifests</h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          Drop folders, ZIP archives, or individual manifest files to install
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
        className={`veil-drop flex-1 min-h-[280px] rounded-2xl flex flex-col items-center justify-center cursor-pointer ${isDragOver ? 'dragging' : ''}`}
      >
        <AnimatePresence mode="wait">
          {status === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="veil-icon-box w-11 h-11 rounded-xl flex items-center justify-center">
                <Upload size={18} strokeWidth={1.5} className="text-white/40" />
              </div>
              <div className="text-center">
                <p className="text-white/70 text-[14px] font-medium">Drag & drop files here</p>
                <p className="text-white/25 text-[12px] mt-1.5">
                  Supports .manifest, .lua files and ZIP archives
                </p>
              </div>
              <button
                onClick={handleBrowse}
                className="veil-btn mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] text-white/80 font-medium tracking-[-0.01em]"
              >
                <FolderOpen size={14} strokeWidth={1.5} />
                Browse Files
              </button>
            </motion.div>
          )}

          {status === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="veil-icon-box w-11 h-11 rounded-xl flex items-center justify-center">
                <FileArchive size={18} strokeWidth={1.5} className="text-white/50 animate-pulse" />
              </div>
              <p className="text-white/50 text-[14px] font-medium">{message || 'Installing manifests...'}</p>
            </motion.div>
          )}

          {status === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex flex-col items-center gap-3"
            >
              <CheckCircle size={36} strokeWidth={1.5} className="text-emerald-400" />
              <p className="text-emerald-400 text-[14px] font-medium">{message || 'Manifests installed successfully'}</p>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex flex-col items-center gap-3"
            >
              <AlertCircle size={36} strokeWidth={1.5} className="text-red-400" />
              <p className="text-red-400 text-[14px] font-medium">{message || 'Failed to install manifests'}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {needsRestart && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-4 veil-card rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <AlertTriangle size={16} strokeWidth={1.5} className="text-amber-400 shrink-0" />
            <p className="text-amber-400/80 text-[12px] font-medium">
              Veil has made changes — please restart Steam for them to take effect
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default InstallPage
