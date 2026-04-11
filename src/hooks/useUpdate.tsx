import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface UpdateInfo {
  available: boolean
  current_version: string
  latest_version: string
  download_url: string
  asset_name: string
  release_notes: string
  release_url: string
}

type Phase = 'idle' | 'checking' | 'downloading' | 'launching' | 'error'

interface UpdateContextValue {
  info: UpdateInfo | null
  phase: Phase
  error: string | null
  checkNow: () => Promise<void>
  installUpdate: () => Promise<void>
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const checkNow = useCallback(async () => {
    setPhase('checking')
    setError(null)
    try {
      const result = await invoke<UpdateInfo>('check_for_update')
      setInfo(result)
      setPhase('idle')
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Update check failed')
      setPhase('error')
    }
  }, [])

  const installUpdate = useCallback(async () => {
    if (!info?.download_url) return
    setPhase('downloading')
    setError(null)
    try {
      await invoke<string>('download_and_run_update', { url: info.download_url })
      setPhase('launching')
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Update install failed')
      setPhase('error')
    }
  }, [info])

  useEffect(() => {
    let cancelled = false
    invoke<UpdateInfo>('check_for_update')
      .then((r) => { if (!cancelled) setInfo(r) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <UpdateContext.Provider value={{ info, phase, error, checkNow, installUpdate }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useUpdate must be used inside UpdateProvider')
  return ctx
}
