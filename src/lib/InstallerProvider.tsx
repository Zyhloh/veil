import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { useLibrary } from './library-context'
import { getAppsMeta } from './library'
import { installManifestPaths } from './install'
import { fixLibraryManifests } from './fix'
import { pruneImageCache } from './images'
import {
  getAppConfig,
  ensureVeilDll,
  verifyVeilDll,
  syncVeilCategory,
  veilCategoryNeedsSync,
  checkForUpdate,
  type UpdateInfo,
} from './config'
import { cloudSavesEnsure, cloudSavesStatus, type CloudSavesStatus } from './cloudsave'
import { InstallerContext, type ToastState } from './installer-context'

const VALID = /\.(zip|lua|manifest)$/i
const DLL_WATCH_MS = 60_000
const UPDATE_WATCH_MS = 30 * 60_000

export function InstallerProvider({ children }: { children: ReactNode }) {
  const { steamPath, ready, reload } = useLibrary()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudSavesStatus | null>(null)
  const toastId = useRef(0)
  const busyRef = useRef(false)
  const startedRef = useRef(false)

  const showToast = useCallback((kind: ToastState['kind'], message: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, kind, message })
  }, [])

  const clearToast = useCallback((id: number) => {
    setToast((current) => (current && current.id === id ? null : current))
  }, [])

  const refreshUpdate = useCallback(async () => {
    const info = await checkForUpdate().catch(() => null)
    if (info) setUpdateInfo(info)
  }, [])

  const refreshCloud = useCallback(async () => {
    if (!steamPath) return
    const status = await cloudSavesStatus(steamPath).catch(() => null)
    if (status) setCloudStatus(status)
  }, [steamPath])

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (busyRef.current) return
      const valid = paths.filter((p) => VALID.test(p))
      if (valid.length === 0) {
        showToast('error', 'Drop a valid .zip, .lua, or .manifest')
        return
      }
      if (!steamPath) {
        showToast('error', 'Steam installation not found')
        return
      }
      busyRef.current = true
      try {
        const report = await installManifestPaths(steamPath, valid)
        if (report.lua_count + report.manifest_count === 0) {
          showToast('error', 'No valid manifests in that drop')
          return
        }
        await fixLibraryManifests(steamPath, true).catch(() => null)
        await reload()

        const cfg = await getAppConfig().catch(() => null)
        if (cfg?.veil_category) {
          await syncVeilCategory(steamPath).catch(() => null)
        }

        let label = 'Manifests'
        if (report.app_ids.length === 1) {
          const metas = await getAppsMeta(report.app_ids).catch(() => [])
          label = metas[0]?.name ?? `App ${report.app_ids[0]}`
        } else if (report.app_ids.length > 1) {
          label = `${report.app_ids.length} games`
        }
        showToast('success', `${label} installed — restart Steam to use`)

        const running = await invoke<boolean>('check_steam_running').catch(() => false)
        if (running) setRestartRequired(true)
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : 'Install failed')
      } finally {
        busyRef.current = false
      }
    },
    [steamPath, reload, showToast],
  )

  useEffect(() => {
    pruneImageCache()
  }, [])

  // Startup orchestration: auto-update -> Veil DLL -> Veil category -> ready.
  useEffect(() => {
    if (!ready || startedRef.current) return
    startedRef.current = true

    const step = (label: string, pct: number) => {
      void emit('startup:progress', { label, pct })
    }

    ;(async () => {
      const cfg = await getAppConfig().catch(() => null)
      const sp = cfg?.steam_path || steamPath || ''

      step('Checking for updates', 22)
      try {
        const info = await checkForUpdate()
        setUpdateInfo(info)
        if (info.available && info.download_url) {
          step('Updating Veil', 40)
          await invoke('download_and_run_update', { url: info.download_url })
          return // app exits to run installer
        }
      } catch {
        /* offline / no release — continue */
      }

      if (cfg?.veil_enabled && sp) {
        step('Enabling Veil', 52)
        const res = await ensureVeilDll(sp).catch(() => '')
        if (res === 'repaired') await invoke('start_steam').catch(() => {})
      }

      if (cfg?.veil_category && sp) {
        step('Syncing collections', 70)
        try {
          if (await veilCategoryNeedsSync(sp)) {
            const running = await invoke<boolean>('check_steam_running').catch(() => false)
            if (running) await invoke('kill_steam').catch(() => {})
            await syncVeilCategory(sp).catch(() => {})
            if (running) await invoke('start_steam').catch(() => {})
          }
        } catch {
          /* ignore */
        }
      }

      if (sp && cfg?.veil_enabled) {
        step('Setting up Cloud Saves', 84)
        const status = await cloudSavesEnsure(sp).catch(() => null)
        if (status) setCloudStatus(status)
      } else if (sp) {
        cloudSavesStatus(sp).then(setCloudStatus).catch(() => {})
      }

      step('Loading library', 92)
      await invoke('mark_main_ready').catch(() => {})

      // Background manifest backfill (non-blocking).
      if (sp) {
        fixLibraryManifests(sp, false)
          .then(async (r) => {
            if (r && r.updated > 0) {
              await reload()
              const running = await invoke<boolean>('check_steam_running').catch(() => false)
              if (running) setRestartRequired(true)
            }
          })
          .catch(() => {})
      }
    })()
  }, [ready, steamPath, reload])

  // Background watchdogs: DLL integrity + app updates.
  useEffect(() => {
    if (!ready) return
    const dllTimer = setInterval(async () => {
      const cfg = await getAppConfig().catch(() => null)
      if (!cfg?.veil_enabled || !cfg.steam_path || cfg.patches_applied) return
      const v = await verifyVeilDll(cfg.steam_path).catch(() => null)
      if (v && !v.ok) {
        const r = await ensureVeilDll(cfg.steam_path).catch(() => '')
        if (r === 'repaired') await invoke('start_steam').catch(() => {})
      }
    }, DLL_WATCH_MS)

    const updateTimer = setInterval(() => {
      checkForUpdate()
        .then((info) => setUpdateInfo(info))
        .catch(() => {})
    }, UPDATE_WATCH_MS)

    return () => {
      clearInterval(dllTimer)
      clearInterval(updateTimer)
    }
  }, [ready])

  return (
    <InstallerContext.Provider
      value={{
        toast,
        clearToast,
        restartRequired,
        setRestartRequired,
        importPaths,
        notify: showToast,
        updateInfo,
        setUpdateInfo,
        refreshUpdate,
        cloudStatus,
        setCloudStatus,
        refreshCloud,
      }}
    >
      {children}
    </InstallerContext.Provider>
  )
}
