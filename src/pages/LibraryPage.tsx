import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretDown, DotsThreeVertical, ArrowsClockwise, CircleNotch, SquaresFour, DownloadSimple, TrashSimple, MinusCircle, MagnifyingGlass, X } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import ContextMenu, { type MenuEntry } from '../components/ContextMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import SmartImage from '../components/SmartImage'
import ScrollFade from '../components/ScrollFade'
import { useLibrary } from '../lib/library-context'
import {
  removeManifest,
  uninstallGame,
  uninstallDlc,
  openFolder,
  openUrl,
  launchWithSteam,
  launchWithoutSteam,
  headerSources,
  type InstalledGame,
  type AppMeta,
} from '../lib/library'
import { catalogInstallSelection } from '../lib/catalog'
import { useInView, useReleasedDlc } from '../lib/dlc'
import { useInstaller } from '../lib/installer-context'

const EMPTY_DLC: number[] = []

const EASE = [0.25, 0.46, 0.45, 0.94] as const

function GameImage({
  appId,
  headerUrl,
  className,
}: {
  appId: string
  headerUrl?: string
  className?: string
}) {
  const sources = useMemo(() => headerSources(appId, headerUrl || undefined), [appId, headerUrl])
  return <SmartImage sources={sources} className={className} />
}

function LibrarySearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const expanded = open || value.length > 0

  return (
    <motion.div
      initial={false}
      animate={{ width: expanded ? 220 : 32 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="relative flex h-8 items-center overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.02]"
    >
      <button
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 transition hover:text-neutral-200"
      >
        <MagnifyingGlass size={15} weight="bold" />
      </button>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) setOpen(false)
        }}
        placeholder="Search library…"
        tabIndex={expanded ? 0 : -1}
        className="h-full min-w-0 flex-1 bg-transparent pr-8 text-[12.5px] text-neutral-200 outline-none placeholder:text-neutral-600"
      />
      {expanded && value && (
        <button
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 transition hover:text-neutral-300 active:scale-90"
        >
          <X size={13} weight="bold" />
        </button>
      )}
    </motion.div>
  )
}

interface DlcRow {
  id: number
  name: string
  installed: boolean
}

function GameCard({
  game,
  meta,
  installedIds,
  dlcBusy,
  expanded,
  removing,
  index,
  onToggle,
  onContext,
  onToggleMenu,
  onDlcAction,
  onDlc,
  onInstallAll,
  installingAll,
}: {
  game: InstalledGame
  meta?: AppMeta
  installedIds: Set<string>
  dlcBusy: Set<number>
  expanded: boolean
  removing: boolean
  index: number
  onToggle: () => void
  onContext: (x: number, y: number) => void
  onToggleMenu: (x: number, y: number) => void
  onDlcAction: (dlc: DlcRow, action: 'install' | 'uninstall') => void
  onDlc: (appId: number, total: number, installed: number) => void
  onInstallAll: (dlcs: DlcRow[]) => void
  installingAll: boolean
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const gridDlc = meta?.dlc_app_ids ?? EMPTY_DLC
  const hasDlcSource = gridDlc.length > 0
  const { dlcIds, metas: dlcMetaMap, loading } = useReleasedDlc(
    Number(game.app_id),
    gridDlc,
    inView,
  )

  const dlcRows = useMemo<DlcRow[]>(
    () =>
      dlcIds
        .map((id) => ({
          id,
          name: dlcMetaMap.get(id)?.name ?? `App ${id}`,
          installed: installedIds.has(String(id)) || game.included_app_ids.includes(id),
        }))
        .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name)),
    [dlcIds, dlcMetaMap, installedIds, game.included_app_ids],
  )

  const resolved = !loading
  const installedDlc = dlcRows.filter((d) => d.installed).length
  const missingDlc = dlcRows.filter((d) => !d.installed)
  const showChip = (hasDlcSource && !resolved) || (resolved && dlcRows.length > 0)

  useEffect(() => {
    if (!resolved) return
    onDlc(Number(game.app_id), dlcRows.length, installedDlc)
  }, [resolved, dlcRows.length, installedDlc, game.app_id, onDlc])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: removing ? 0.4 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.25), ease: EASE }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext(e.clientX, e.clientY)
      }}
      className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]"
    >
      <div
        className={`flex items-center gap-4 p-3 ${showChip ? 'cursor-pointer transition-colors hover:bg-white/[0.015]' : ''}`}
        onClick={() => showChip && onToggle()}
      >
        <GameImage
          appId={game.app_id}
          headerUrl={meta?.header_url}
          className="h-[58px] w-[124px] shrink-0 rounded-md"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-neutral-100">{meta?.name ?? `App ${game.app_id}`}</p>
          <p className="mt-1 text-[11px] font-medium text-neutral-600">App ID {game.app_id}</p>
          <p className="mt-0.5 text-[11px] font-medium text-neutral-700">
            {game.manifest_count} manifest{game.manifest_count !== 1 ? 's' : ''}
            {game.install_dir ? ' · Files installed' : ''}
          </p>
        </div>

        {showChip && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.06] py-1.5 pl-2.5 pr-2">
            {resolved ? (
              <span className="text-[11px] font-semibold leading-none text-neutral-300">
                {installedDlc}/{dlcRows.length}
              </span>
            ) : (
              <CircleNotch size={11} className="animate-spin text-neutral-500" />
            )}
            <span className="text-[11px] font-medium leading-none text-neutral-600">DLC</span>
            <CaretDown
              size={11}
              weight="bold"
              className={`shrink-0 text-neutral-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </div>
        )}

        <button
          data-ctx-trigger
          onClick={(e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onToggleMenu(rect.right, rect.bottom + 6)
          }}
          disabled={removing}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-white/[0.06] hover:text-neutral-200 active:scale-90 disabled:opacity-40"
        >
          {removing ? <CircleNotch size={16} className="animate-spin" /> : <DotsThreeVertical size={18} weight="bold" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && showChip && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mx-3 border-t border-white/[0.06]" />
            <div className="px-3 py-2">
              {resolved && missingDlc.length > 0 && (
                <div className="mb-1 flex items-center justify-between gap-3 px-1 pb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-600">
                    {missingDlc.length} not installed
                  </span>
                  <button
                    onClick={() => onInstallAll(missingDlc)}
                    disabled={installingAll}
                    className="flex h-7 items-center gap-1.5 rounded-md bg-neutral-100 px-2.5 text-[11px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:cursor-default disabled:bg-white/[0.06] disabled:text-neutral-500"
                  >
                    {installingAll ? (
                      <>
                        <CircleNotch size={12} weight="bold" className="animate-spin" />
                        Installing…
                      </>
                    ) : (
                      <>
                        <DownloadSimple size={12} weight="bold" />
                        Install All DLC
                      </>
                    )}
                  </button>
                </div>
              )}
              {!resolved ? (
                <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-neutral-600">
                  <CircleNotch size={14} className="animate-spin" />
                  Loading DLC…
                </div>
              ) : (
                dlcRows.map((dlc) => {
                  const busy = dlcBusy.has(dlc.id)
                  return (
                    <div key={dlc.id} className="flex items-center gap-3 px-1 py-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dlc.installed ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-300">{dlc.name}</span>
                      <button
                        onClick={() => onDlcAction(dlc, dlc.installed ? 'uninstall' : 'install')}
                        disabled={busy}
                        className="group/dlc flex w-[68px] shrink-0 items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide disabled:cursor-default"
                      >
                        {busy ? (
                          <CircleNotch size={12} className="animate-spin text-neutral-500" />
                        ) : dlc.installed ? (
                          <>
                            <span className="text-emerald-500/80 transition group-hover/dlc:hidden">Installed</span>
                            <span className="hidden text-red-400 transition group-hover/dlc:inline">Uninstall</span>
                          </>
                        ) : (
                          <>
                            <span className="text-neutral-600 transition group-hover/dlc:hidden">Available</span>
                            <span className="hidden text-neutral-200 transition group-hover/dlc:inline">Install</span>
                          </>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

interface Modal {
  type: 'remove' | 'uninstall'
  game: InstalledGame
}

export default function LibraryPage() {
  const { steamPath, games, metas, ready, reload } = useLibrary()
  const { importPaths, setRestartRequired } = useInstaller()
  const [dlcBusy, setDlcBusy] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ctx, setCtx] = useState<{ game: InstalledGame; x: number; y: number } | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [dlcStats, setDlcStats] = useState<Record<number, { total: number; installed: number }>>({})
  const [search, setSearch] = useState('')
  const [installingAll, setInstallingAll] = useState<string | null>(null)

  const loading = !ready

  const reportDlc = useCallback((appId: number, total: number, installed: number) => {
    setDlcStats((prev) => {
      const cur = prev[appId]
      if (cur && cur.total === total && cur.installed === installed) return prev
      return { ...prev, [appId]: { total, installed } }
    })
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }, [reload])

  const importFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Manifest Files', extensions: ['zip', 'lua', 'manifest'] }],
    })
    if (!selected) return
    importPaths(Array.isArray(selected) ? selected : [selected])
  }, [importPaths])

  const installedIds = useMemo(() => new Set(games.map((g) => g.app_id)), [games])

  const visible = useMemo(() => {
    return games.filter((g) => {
      const meta = metas.get(g.app_id)
      if (!meta) return true
      return !(meta.kind === 'dlc' && installedIds.has(String(meta.parent_app_id)))
    })
  }, [games, metas, installedIds])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((g) => {
      const name = (metas.get(g.app_id)?.name ?? '').toLowerCase()
      return name.includes(q) || g.app_id.includes(q)
    })
  }, [visible, search, metas])

  const dlcSummary = useMemo(() => {
    let total = 0
    let installed = 0
    for (const g of visible) {
      const s = dlcStats[Number(g.app_id)]
      if (!s) continue
      total += s.total
      installed += s.installed
    }
    return { total, installed }
  }, [visible, dlcStats])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDlcAction = useCallback(
    async (game: InstalledGame, dlc: DlcRow, action: 'install' | 'uninstall') => {
      if (!steamPath) return
      const parentId = Number(game.app_id)
      setDlcBusy((prev) => new Set(prev).add(dlc.id))
      if (action === 'install') {
        const res = await catalogInstallSelection(steamPath, parentId, false, [[dlc.id, dlc.name]]).catch(() => null)
        if (res) setRestartRequired(true)
      } else {
        await uninstallDlc(steamPath, parentId, dlc.id).catch(() => {})
      }
      await reload()
      setDlcBusy((prev) => {
        const next = new Set(prev)
        next.delete(dlc.id)
        return next
      })
    },
    [steamPath, reload, setRestartRequired],
  )

  const handleInstallAll = useCallback(
    async (game: InstalledGame, dlcs: DlcRow[]) => {
      if (!steamPath || dlcs.length === 0) return
      setInstallingAll(game.app_id)
      const res = await catalogInstallSelection(
        steamPath,
        Number(game.app_id),
        false,
        dlcs.map((d) => [d.id, d.name] as [number, string]),
      ).catch(() => null)
      if (res) setRestartRequired(true)
      await reload()
      setInstallingAll(null)
    },
    [steamPath, reload, setRestartRequired],
  )

  const confirm = useCallback(async () => {
    if (!modal || !steamPath) return
    const target = modal
    setModal(null)
    setRemoving(target.game.app_id)
    if (target.type === 'remove') {
      await removeManifest(steamPath, target.game.app_id).catch(() => {})
    } else {
      await uninstallGame(steamPath, target.game.app_id).catch(() => {})
    }
    await reload()
    setRemoving(null)
  }, [modal, steamPath, reload])

  const ctxItems: MenuEntry[] = ctx
    ? [
        {
          label: 'Launch With Steam',
          disabled: !ctx.game.install_dir,
          onClick: () => launchWithSteam(ctx.game.app_id).catch(() => {}),
        },
        {
          label: 'Launch Without Steam',
          disabled: !ctx.game.launch_exe,
          onClick: () =>
            steamPath && launchWithoutSteam(steamPath, ctx.game.app_id).catch(() => {}),
        },
        'divider',
        {
          label: 'View Game Files',
          disabled: !ctx.game.install_dir,
          onClick: () => ctx.game.install_dir && openFolder(ctx.game.install_dir).catch(() => {}),
        },
        {
          label: 'Open Steam Page',
          onClick: () =>
            openUrl(`https://store.steampowered.com/app/${ctx.game.app_id}`).catch(() => {}),
        },
        'divider',
        { label: 'Remove Manifest', onClick: () => setModal({ type: 'remove', game: ctx.game }) },
        { label: 'Uninstall', danger: true, onClick: () => setModal({ type: 'uninstall', game: ctx.game }) },
      ]
    : []

  const modalName = modal ? (metas.get(modal.game.app_id)?.name ?? `App ${modal.game.app_id}`) : ''

  return (
    <div className="flex h-full flex-col px-10 py-8">
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <CircleNotch size={22} className="animate-spin" />
          <p className="text-[13px] font-medium">Loading library…</p>
        </div>
      ) : !steamPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-600">
          <p className="text-[13px] font-medium text-neutral-400">Steam installation not found</p>
          <p className="text-[12px]">Set your Steam path in Settings.</p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2.5 text-[13px] text-neutral-500">
              <span>
                <span className="font-bold text-neutral-200">{visible.length}</span> App
                {visible.length !== 1 ? 's' : ''}
              </span>
              {dlcSummary.total > 0 && (
                <>
                  <span className="text-neutral-700">·</span>
                  <span>
                    <span className="font-bold text-neutral-200">
                      {dlcSummary.installed}/{dlcSummary.total}
                    </span>{' '}
                    DLC
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <LibrarySearch value={search} onChange={setSearch} />
              <button
                onClick={importFiles}
                className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 text-[12px] font-semibold text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200 active:scale-95"
              >
                <DownloadSimple size={14} weight="bold" />
                Import
              </button>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 text-[12px] font-semibold text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200 active:scale-95 disabled:opacity-50"
              >
                <ArrowsClockwise size={14} weight="bold" className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
              <SquaresFour size={26} />
              <p className="text-[13px] font-medium">No manifests installed</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
              <MagnifyingGlass size={24} />
              <p className="text-[13px] font-medium">No games match “{search.trim()}”</p>
            </div>
          ) : (
            <ScrollFade className="flex-1 pr-1" contentClassName="space-y-2.5">
              {filtered.map((game, i) => (
                <GameCard
                  key={game.app_id}
                  game={game}
                  meta={metas.get(game.app_id)}
                  installedIds={installedIds}
                  dlcBusy={dlcBusy}
                  expanded={expanded.has(game.app_id)}
                  removing={removing === game.app_id}
                  index={i}
                  onToggle={() => toggle(game.app_id)}
                  onContext={(x, y) => setCtx({ game, x, y })}
                  onToggleMenu={(x, y) =>
                    setCtx((prev) => (prev && prev.game.app_id === game.app_id ? null : { game, x, y }))
                  }
                  onDlcAction={(dlc, action) => handleDlcAction(game, dlc, action)}
                  onDlc={reportDlc}
                  onInstallAll={(dlcs) => handleInstallAll(game, dlcs)}
                  installingAll={installingAll === game.app_id}
                />
              ))}
            </ScrollFade>
          )}
        </>
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}

      {modal && (
        <ConfirmDialog
          title={modal.type === 'remove' ? 'Remove manifest?' : `Uninstall ${modalName}?`}
          message={
            modal.type === 'remove'
              ? `This removes the Veil manifest for ${modalName}. Your installed game files are kept.`
              : `This closes ${modalName} if it's running, deletes its manifest, and removes the installed files from your Steam library. This can't be undone.`
          }
          confirmLabel={modal.type === 'remove' ? 'Remove manifest' : 'Uninstall'}
          danger={modal.type === 'uninstall'}
          icon={modal.type === 'remove' ? <MinusCircle size={20} weight="bold" /> : <TrashSimple size={20} weight="bold" />}
          onConfirm={confirm}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  )
}
