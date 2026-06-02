import { createContext, useContext } from 'react'
import type { UpdateInfo } from './config'

export interface ToastState {
  id: number
  kind: 'success' | 'error'
  message: string
}

export interface InstallerValue {
  toast: ToastState | null
  clearToast: (id: number) => void
  restartRequired: boolean
  setRestartRequired: (value: boolean) => void
  importPaths: (paths: string[]) => Promise<void>
  notify: (kind: ToastState['kind'], message: string) => void
  updateInfo: UpdateInfo | null
  setUpdateInfo: (info: UpdateInfo | null) => void
  refreshUpdate: () => Promise<void>
}

export const InstallerContext = createContext<InstallerValue | null>(null)

export function useInstaller(): InstallerValue {
  const value = useContext(InstallerContext)
  if (!value) throw new Error('useInstaller must be used within InstallerProvider')
  return value
}
