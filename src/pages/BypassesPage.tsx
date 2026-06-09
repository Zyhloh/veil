import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  MagnifyingGlass,
  X,
  Check,
  CircleNotch,
  DownloadSimple,
  Warning,
  FolderOpen,
  ArrowsClockwise,
  Trash,
  ArrowSquareOut,
} from '@phosphor-icons/react'
import { openUrl } from '../lib/library'
import { useInView } from '../lib/dlc'
import { useMaximized } from '../lib/useMaximized'
import { useLibrary } from '../lib/library-context'
import { useInstaller } from '../lib/installer-context'
import {
  fetchBypasses,
  bypassCheck,
  bypassInstall,
  bypassRemove,
  bypassSetLaunchOptions,
  type BypassInfo,
  type BypassCheckResult,
} from '../lib/bypasses'
import SteamArt from '../components/SteamArt'
import ScrollFade from '../components/ScrollFade'

const OVERRIDE_KEY = 'veil.bypass.overrides.v1'

function loadOverrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveOverrides(map: Record<string, string>) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map))
}

interface Progress {
  app_id: number
  phase: 'download' | 'extract' | 'done'
  current: number
  total: number
  label: string | null
}

type Busy = { id: number; kind: 'installing' | 'removing' } | null

function BypassCard({
  item,
  status,
  busy,
  progress,
  onOpen,
  onGet,
  onVisible,
}: {
  item: BypassInfo
  status: BypassCheckResult | null
  busy: boolean
  progress: Progress | null
  onOpen: () => void
  onGet: () => void
  onVisible: () => void
}) {
  const [ref, inView] = useInView<HTMLDivElement>()

  useEffect(() => {
    if (inView) onVisible()
  }, [inView])

  const state = status?.state
  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onOpen}
      className="group relative aspect-[460/215] cursor-pointer overflow-hidden rounded-xl border border-white/[0.06] transition-colors hover:border-white/[0.14]"
    >
      <SteamArt appId={item.AppID} className="h-full w-full" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pb-2.5 pt-12">
        <div className="min-w-0 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
          <p className="truncate text-[13px] font-bold text-white">{item.AppName}</p>
          <p className="text-[10px] font-medium text-white/55">
            App ID {item.AppID} · {item.LastUpdated}
          </p>
        </div>
        {busy ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold text-white">
            <CircleNotch size={12} weight="bold" className="animate-spin" />
            {pct !== null ? `${pct}%` : '…'}
          </span>
        ) : state === 'installed' ? (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-300">
            <Check size={12} weight="bold" />
            Installed
          </span>
        ) : state === 'available' ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onGet()
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-black/80 active:scale-95"
          >
            <DownloadSimple size={12} weight="bold" />
            Get
          </button>
        ) : state === 'wrong_version' ? (
          <span
            onClick={(e) => e.stopPropagation()}
            title={`Requires build ${status?.required_build ?? '?'}${status?.actual_build ? ` · installed ${status.actual_build}` : ''}`}
            className="flex shrink-0 cursor-help items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300"
          >
            <Warning size={12} weight="bold" />
            Wrong build
          </span>
        ) : state === 'not_installed' ? (
          <span
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 cursor-not-allowed items-center rounded-md border border-white/10 bg-black/50 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-500"
          >
            Not installed
          </span>
        ) : (
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/50">
            <CircleNotch size={12} className="animate-spin text-neutral-500" />
          </span>
        )}
      </div>
    </motion.div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-28 shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-600">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] text-neutral-300">{children}</span>
    </div>
  )
}

function BypassDetailsModal({
  item,
  status,
  busy,
  progress,
  override,
  onClose,
  onInstall,
  onRepair,
  onRemove,
  onSetOverride,
}: {
  item: BypassInfo
  status: BypassCheckResult | null
  busy: Busy
  progress: Progress | null
  override: string | null
  onClose: () => void
  onInstall: () => void
  onRepair: () => void
  onRemove: () => void
  onSetOverride: (path: string | null) => void
}) {
  const maximized = useMaximized()
  const state = status?.state
  const isBusy = busy?.id === item.AppID
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null

  const pickPath = async () => {
    const dir = await openDialog({ directory: true, multiple: false })
    if (typeof dir === 'string') onSetOverride(dir)
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      onMouseDown={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] shadow-2xl shadow-black/60"
      >
        <div className="relative shrink-0">
          <SteamArt appId={item.AppID} className="aspect-[460/215] w-full" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/25 to-transparent" />
          <h2 className="pointer-events-none absolute inset-x-5 bottom-3 truncate text-lg font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.85)]">
            {item.AppName}
          </h2>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-neutral-300 transition hover:bg-black/70 hover:text-white active:scale-90"
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <DetailRow label="App ID">{item.AppID}</DetailRow>
          <DetailRow label="Updated">{item.LastUpdated}</DetailRow>
          {item.RequiredBuild && (
            <DetailRow label="Build">
              <span className="font-mono text-[12px] text-neutral-300">{item.RequiredBuild}</span>
              {state === 'wrong_version' && status?.actual_build && (
                <span className="ml-2 text-[11px] text-amber-300">
                  installed <span className="font-mono">{status.actual_build}</span>
                </span>
              )}
            </DetailRow>
          )}
          <DetailRow label="Files">{item.Files.length} file{item.Files.length !== 1 ? 's' : ''}</DetailRow>
          {item.LaunchArgs && (
            <DetailRow label="Launch args">
              <span className="text-[11px] text-neutral-600">Set automatically on install.</span>
            </DetailRow>
          )}
          <DetailRow label="Location">
            {override ? (
              <span className="break-all font-mono text-[11px] text-amber-300/90">{override}</span>
            ) : status?.install_dir ? (
              <span className="break-all font-mono text-[11px] text-neutral-500">{status.install_dir}</span>
            ) : (
              <span className="text-[11px] text-neutral-600">Resolved from your Steam library.</span>
            )}
          </DetailRow>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={pickPath}
              className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-300 transition hover:bg-white/[0.05] hover:text-neutral-100 active:scale-95"
            >
              <FolderOpen size={13} weight="bold" />
              Set game path
            </button>
            {override && (
              <button
                onClick={() => onSetOverride(null)}
                className="rounded-md border border-white/[0.08] px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-400 transition hover:bg-white/[0.05] hover:text-neutral-200 active:scale-95"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => openUrl(`https://store.steampowered.com/app/${item.AppID}`).catch(() => {})}
              className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:text-neutral-300 active:scale-95"
            >
              <ArrowSquareOut size={13} weight="bold" />
              Steam
            </button>
          </div>

          {state === 'not_installed' && !override && (
            <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] leading-relaxed text-neutral-500">
              This game isn't detected in your Steam libraries. Install it in Steam first, or set the game folder manually above.
            </p>
          )}
          {state === 'wrong_version' && (
            <p className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-amber-200/90">
              The installed game build doesn't match this bypass. Update the game in Steam, or set the path manually to override.
            </p>
          )}

          {isBusy && progress && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500">
                <span className="capitalize">{progress.phase === 'extract' ? 'Extracting' : 'Downloading'}</span>
                <span>{pct !== null ? `${pct}%` : ''}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-neutral-300 transition-all duration-150"
                  style={{ width: `${pct ?? 8}%` }}
                />
              </div>
              {progress.label && (
                <p className="mt-1 truncate text-[10.5px] text-neutral-600">{progress.label}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
          {state === 'installed' ? (
            <>
              <button
                onClick={onRepair}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-[12.5px] font-semibold text-neutral-300 transition hover:bg-white/[0.05] hover:text-neutral-100 active:scale-95 disabled:opacity-50"
              >
                {isBusy && busy?.kind === 'installing' ? (
                  <CircleNotch size={15} weight="bold" className="animate-spin" />
                ) : (
                  <ArrowsClockwise size={15} weight="bold" />
                )}
                Repair
              </button>
              <button
                onClick={onRemove}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3.5 py-2 text-[12.5px] font-semibold text-red-300 transition hover:bg-red-500/25 active:scale-95 disabled:opacity-50"
              >
                {isBusy && busy?.kind === 'removing' ? (
                  <CircleNotch size={15} weight="bold" className="animate-spin" />
                ) : (
                  <Trash size={15} weight="bold" />
                )}
                Remove
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              disabled={!!busy || (state === 'not_installed' && !override)}
              className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-neutral-600"
            >
              {isBusy ? (
                <>
                  <CircleNotch size={15} weight="bold" className="animate-spin" />
                  {pct !== null ? `${pct}%` : 'Installing…'}
                </>
              ) : (
                <>
                  <DownloadSimple size={15} weight="bold" />
                  {state === 'wrong_version' ? 'Install anyway' : 'Install bypass'}
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

export default function BypassesPage() {
  const { steamPath } = useLibrary()
  const { notify } = useInstaller()
  const [items, setItems] = useState<BypassInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statuses, setStatuses] = useState<Map<number, BypassCheckResult>>(new Map())
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadOverrides())
  const [selected, setSelected] = useState<BypassInfo | null>(null)
  const checkedRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    fetchBypasses()
      .then((list) => {
        if (!alive) return
        setItems(list)
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const unlisten = listen<Progress>('bypass-progress', (e) => setProgress(e.payload))
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const overrideFor = useCallback((appId: number) => overrides[String(appId)] ?? null, [overrides])

  const check = useCallback(
    async (item: BypassInfo) => {
      if (!steamPath) return
      const res = await bypassCheck(
        steamPath,
        item.AppID,
        item.Files,
        overrideFor(item.AppID),
        item.RequiredBuild ?? null,
      ).catch(() => null)
      if (res) setStatuses((prev) => new Map(prev).set(item.AppID, res))
    },
    [steamPath, overrideFor],
  )

  const onVisible = useCallback(
    (item: BypassInfo) => {
      if (checkedRef.current.has(item.AppID)) return
      checkedRef.current.add(item.AppID)
      check(item)
    },
    [check],
  )

  const setOverride = useCallback(
    (appId: number, path: string | null) => {
      setOverrides((prev) => {
        const next = { ...prev }
        if (path) next[String(appId)] = path
        else delete next[String(appId)]
        saveOverrides(next)
        return next
      })
      const item = items.find((i) => i.AppID === appId)
      if (item) setTimeout(() => check(item), 0)
    },
    [items, check],
  )

  const applyLaunchArgs = useCallback(
    async (item: BypassInfo, value: string) => {
      if (!item.LaunchArgs || !steamPath) return
      const running = await invoke<boolean>('check_steam_running').catch(() => false)
      if (running) await invoke('kill_steam').catch(() => {})
      await bypassSetLaunchOptions(steamPath, item.AppID, value).catch(() => {})
      if (running) await invoke('start_steam').catch(() => {})
    },
    [steamPath],
  )

  const install = useCallback(
    async (item: BypassInfo, kind: 'installing' = 'installing') => {
      if (!steamPath || busy) return
      setBusy({ id: item.AppID, kind })
      setProgress(null)
      try {
        await bypassInstall(steamPath, item.AppID, overrideFor(item.AppID), item.RequiredBuild ?? null)
        if (item.LaunchArgs) await applyLaunchArgs(item, item.LaunchArgs)
        await check(item)
        notify('success', `${item.AppName} bypass installed.`)
      } catch (e) {
        notify('error', e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
        setProgress(null)
      }
    },
    [steamPath, busy, overrideFor, applyLaunchArgs, check, notify],
  )

  const remove = useCallback(
    async (item: BypassInfo) => {
      if (!steamPath || busy) return
      setBusy({ id: item.AppID, kind: 'removing' })
      try {
        const res = await bypassRemove(steamPath, item.AppID, item.Files, overrideFor(item.AppID))
        if (item.LaunchArgs) await applyLaunchArgs(item, '')
        await check(item)
        notify('success', `Removed ${res.removed} file${res.removed !== 1 ? 's' : ''} for ${item.AppName}.`)
      } catch (e) {
        notify('error', e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [steamPath, busy, overrideFor, applyLaunchArgs, check, notify],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.AppName.toLowerCase().includes(q) || String(it.AppID).includes(q))
  }, [items, query])

  const selectedStatus = selected ? statuses.get(selected.AppID) ?? null : null

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="relative mb-5 shrink-0">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bypasses…"
          className="h-10 w-full select-text rounded-lg border border-white/[0.08] bg-white/[0.02] pl-9 pr-9 text-[13px] text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/[0.16] focus:bg-white/[0.03]"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-600 transition hover:text-neutral-300 active:scale-90"
          >
            <X size={14} weight="bold" />
          </button>
        )}
      </div>

      <div className="mb-3 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-600">
          {loading ? 'Bypasses' : `${filtered.length} bypass${filtered.length !== 1 ? 'es' : ''}`}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <CircleNotch size={22} className="animate-spin" />
          <p className="text-[13px] font-medium">Loading bypasses…</p>
        </div>
      ) : !steamPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-600">
          <p className="text-[13px] font-medium text-neutral-400">Steam installation not found</p>
          <p className="text-[12px]">Set your Steam path in Settings.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <Warning size={24} />
          <p className="text-[13px] font-medium">No bypasses found</p>
        </div>
      ) : (
        <ScrollFade className="flex-1 pr-1" contentClassName="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 py-1">
          {filtered.map((item) => (
            <BypassCard
              key={item.AppID}
              item={item}
              status={statuses.get(item.AppID) ?? null}
              busy={busy?.id === item.AppID}
              progress={progress?.app_id === item.AppID ? progress : null}
              onOpen={() => setSelected(item)}
              onGet={() => install(item)}
              onVisible={() => onVisible(item)}
            />
          ))}
        </ScrollFade>
      )}

      {selected && (
        <BypassDetailsModal
          item={selected}
          status={selectedStatus}
          busy={busy}
          progress={progress?.app_id === selected.AppID ? progress : null}
          override={overrideFor(selected.AppID)}
          onClose={() => setSelected(null)}
          onInstall={() => install(selected)}
          onRepair={() => install(selected)}
          onRemove={() => remove(selected)}
          onSetOverride={(path) => setOverride(selected.AppID, path)}
        />
      )}
    </div>
  )
}
