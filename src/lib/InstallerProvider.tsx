import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { useLibrary } from './library-context'
import { getAppsMeta, type AppMeta } from './library'
import { installManifestPaths, installManifestBlob, type InstallReport } from './install'
import { catalogInstall, catalogInstallSelection } from './catalog'
import { parseAppIds } from './dropimport'
import { fixLibraryManifests } from './fix'
import { pruneImageCache } from './images'
import {
  getAppConfig,
  ensureVeilDll,
  verifyVeilDll,
  checkForUpdate,
  type UpdateInfo,
} from './config'
import { cloudSavesEnsure, cloudSavesStatus, type CloudSavesStatus } from './cloudsave'
import { InstallerContext, type ToastState, type DropResult, type DropDlcGroup } from './installer-context'

const VALID = /\.(zip|lua|manifest)$/i
const DLL_WATCH_MS = 60_000
const UPDATE_WATCH_MS = 30 * 60_000

export function InstallerProvider({ children }: { children: ReactNode }) {
  const { steamPath, games, ready, reload } = useLibrary()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudSavesStatus | null>(null)
  const [processing, setProcessing] = useState<{ label: string } | null>(null)
  const [dropResult, setDropResult] = useState<DropResult | null>(null)
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

  const finishInstall = useCallback(
    async (report: InstallReport, path: string) => {
      if (report.lua_count + report.manifest_count === 0) {
        showToast('error', 'No valid manifests in that drop')
        return
      }
      await fixLibraryManifests(path, true).catch(() => null)
      await reload()

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
    },
    [reload, showToast],
  )

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (busyRef.current) return
      const valid = paths.filter((p) => VALID.test(p))
      if (valid.length === 0) {
        showToast('error', 'Drop a .zip, .lua, .manifest, or a SteamDB link / App ID')
        return
      }
      if (!steamPath) {
        showToast('error', 'Steam installation not found')
        return
      }
      busyRef.current = true
      setProcessing({ label: 'Installing…' })
      try {
        const report = await installManifestPaths(steamPath, valid)
        await finishInstall(report, steamPath)
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : 'Install failed')
      } finally {
        setProcessing(null)
        busyRef.current = false
      }
    },
    [steamPath, finishInstall, showToast],
  )

  const importFiles = useCallback(
    async (files: File[]) => {
      if (busyRef.current) return
      const valid = files.filter((f) => VALID.test(f.name))
      if (valid.length === 0) {
        showToast('error', 'Drop a .zip, .lua, .manifest, or a SteamDB link / App ID')
        return
      }
      if (!steamPath) {
        showToast('error', 'Steam installation not found')
        return
      }
      busyRef.current = true
      setProcessing({ label: 'Installing dropped files…' })
      try {
        const reports: InstallReport[] = []
        for (const f of valid) {
          setProcessing({ label: `Installing ${f.name}…` })
          const buf = await f.arrayBuffer()
          reports.push(await installManifestBlob(steamPath, f.name, new Uint8Array(buf)))
        }
        const report: InstallReport = {
          entries: reports.flatMap((r) => r.entries),
          lua_count: reports.reduce((n, r) => n + r.lua_count, 0),
          manifest_count: reports.reduce((n, r) => n + r.manifest_count, 0),
          skipped: reports.reduce((n, r) => n + r.skipped, 0),
          app_ids: [...new Set(reports.flatMap((r) => r.app_ids))].sort((a, b) => a - b),
        }
        await finishInstall(report, steamPath)
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : 'Install failed')
      } finally {
        setProcessing(null)
        busyRef.current = false
      }
    },
    [steamPath, finishInstall, showToast],
  )

  const importText = useCallback(
    async (text: string) => {
      if (busyRef.current) return
      if (!steamPath) {
        showToast('error', 'Steam installation not found')
        return
      }
      const ids = parseAppIds(text)
      if (ids.length === 0) {
        showToast('error', 'No Steam App IDs found in that text')
        return
      }
      busyRef.current = true
      setProcessing({ label: 'Looking up apps…' })
      try {
        const metas = await getAppsMeta(ids).catch(() => [] as AppMeta[])
        const map = new Map(metas.map((m) => [m.app_id, m]))

        const parentIds = [
          ...new Set(metas.filter((m) => m.kind === 'dlc' && m.parent_app_id > 0).map((m) => m.parent_app_id)),
        ].filter((p) => !map.has(p))
        if (parentIds.length > 0) {
          ;(await getAppsMeta(parentIds).catch(() => [] as AppMeta[])).forEach((m) => map.set(m.app_id, m))
        }

        const realName = (m?: AppMeta) => (m && m.name && !/^App \d+$/.test(m.name) ? m.name : '')
        const nameOf = (id: number) => realName(map.get(id)) || `App ${id}`
        const installedMains = new Set(games.map((g) => Number(g.app_id)))

        const addBuckets = new Map<number, { id: number; name: string }[]>()
        const missBuckets = new Map<number, { id: number; name: string }[]>()
        const gameIds: number[] = []
        const already: { id: number; name: string }[] = []
        const unknown: number[] = []

        for (const id of ids) {
          const m = map.get(id)
          if (m && m.kind === 'dlc' && m.parent_app_id > 0) {
            const p = m.parent_app_id
            const bucket = installedMains.has(p) ? addBuckets : missBuckets
            const arr = bucket.get(p) ?? []
            arr.push({ id, name: nameOf(id) })
            bucket.set(p, arr)
          } else if (realName(m)) {
            if (installedMains.has(id)) already.push({ id, name: nameOf(id) })
            else gameIds.push(id)
          } else {
            unknown.push(id)
          }
        }

        const added: DropDlcGroup[] = []
        for (const [p, dlcs] of addBuckets) {
          setProcessing({ label: `Adding DLC to ${nameOf(p)}…` })
          const res = await catalogInstallSelection(
            steamPath,
            p,
            false,
            dlcs.map((d) => [d.id, d.name] as [number, string]),
          ).catch(() => null)
          const okIds = res
            ? new Set(
                res.statuses
                  .filter((s) => s.status === 'installed' || s.status === 'appended')
                  .map((s) => s.app_id),
              )
            : new Set(dlcs.map((d) => d.id))
          added.push({ parentId: p, parentName: nameOf(p), dlcs: dlcs.filter((d) => okIds.has(d.id)) })
        }

        const gameResults: { id: number; name: string; ok: boolean }[] = []
        for (const id of gameIds) {
          setProcessing({ label: `Installing ${nameOf(id)}…` })
          const ok = await catalogInstall(id, steamPath)
            .then(() => true)
            .catch(() => false)
          gameResults.push({ id, name: nameOf(id), ok })
        }

        const missing: DropDlcGroup[] = [...missBuckets].map(([p, dlcs]) => ({
          parentId: p,
          parentName: nameOf(p),
          dlcs,
        }))

        await fixLibraryManifests(steamPath, true).catch(() => null)
        await reload()

        const totalAdded = added.reduce((n, g) => n + g.dlcs.length, 0)
        const gamesOk = gameResults.filter((g) => g.ok).length
        if (totalAdded > 0 || gamesOk > 0) {
          const running = await invoke<boolean>('check_steam_running').catch(() => false)
          if (running) setRestartRequired(true)
        }

        const hasProblems = missing.length > 0 || unknown.length > 0 || gameResults.some((g) => !g.ok)
        if (hasProblems) {
          setDropResult({ added, missing, games: gameResults, already, unknown })
        } else if (totalAdded > 0 || gamesOk > 0) {
          const parts: string[] = []
          if (totalAdded > 0) parts.push(`${totalAdded} DLC added`)
          if (gamesOk > 0) parts.push(`${gamesOk} game${gamesOk > 1 ? 's' : ''} installed`)
          showToast('success', `${parts.join(' · ')} — restart Steam to use`)
        } else if (already.length > 0) {
          showToast('success', `${already.map((a) => a.name).join(', ')} already in your library`)
        } else {
          showToast('error', 'Nothing to add from that drop')
        }
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : 'Could not process that drop')
      } finally {
        setProcessing(null)
        busyRef.current = false
      }
    },
    [steamPath, games, reload, showToast],
  )

  useEffect(() => {
    pruneImageCache()
  }, [])

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
          return
        }
      } catch {
      }

      if (cfg?.veil_enabled && sp) {
        step('Enabling Veil', 52)
        const res = await ensureVeilDll(sp).catch(() => '')
        if (res === 'repaired') await invoke('start_steam').catch(() => {})
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
        importFiles,
        importText,
        processing,
        dropResult,
        clearDropResult: () => setDropResult(null),
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
