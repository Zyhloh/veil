import { createContext, useContext } from 'react'
import type { UpdateInfo } from './config'
import type { CloudSavesStatus } from './cloudsave'

export interface ToastState {
  id: number
  kind: 'success' | 'error'
  message: string
}

export interface DropDlcGroup {
  parentId: number
  parentName: string
  dlcs: { id: number; name: string }[]
}

export interface DropResult {
  added: DropDlcGroup[]
  missing: DropDlcGroup[]
  games: { id: number; name: string; ok: boolean }[]
  already: { id: number; name: string }[]
  unknown: number[]
}

export interface InstallerValue {
  toast: ToastState | null
  clearToast: (id: number) => void
  restartRequired: boolean
  setRestartRequired: (value: boolean) => void
  importPaths: (paths: string[]) => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  importText: (text: string) => Promise<void>
  processing: { label: string } | null
  dropResult: DropResult | null
  clearDropResult: () => void
  notify: (kind: ToastState['kind'], message: string) => void
  updateInfo: UpdateInfo | null
  setUpdateInfo: (info: UpdateInfo | null) => void
  refreshUpdate: () => Promise<void>
  cloudStatus: CloudSavesStatus | null
  setCloudStatus: (status: CloudSavesStatus | null) => void
  refreshCloud: () => Promise<void>
}

export const InstallerContext = createContext<InstallerValue | null>(null)

export function useInstaller(): InstallerValue {
  const value = useContext(InstallerContext)
  if (!value) throw new Error('useInstaller must be used within InstallerProvider')
  return value
}
