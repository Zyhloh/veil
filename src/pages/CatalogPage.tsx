import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MagnifyingGlass, X, Check, CircleNotch, DownloadSimple, Warning } from '@phosphor-icons/react'
import { useLibrary } from '../lib/library-context'
import { useInstaller } from '../lib/installer-context'
import { getAppsMeta, type AppMeta } from '../lib/library'
import { useInView, useReleasedDlc } from '../lib/dlc'
import {
  catalogTrending,
  catalogSearch,
  catalogInstall,
  catalogInstallAt,
  type CatalogItem,
} from '../lib/catalog'
import CatalogDetailsModal from '../components/CatalogDetailsModal'
import InstallSelectModal from '../components/InstallSelectModal'
import SteamArt from '../components/SteamArt'
import ScrollFade from '../components/ScrollFade'

interface DisplayGame {
  app_id: number
  name: string
  header_url: string
  dlc_app_ids: number[]
}

function CatalogCard({
  game,
  installed,
  installing,
  unavailable,
  pending,
  index,
  onOpen,
  onAdd,
  onManage,
}: {
  game: DisplayGame
  installed: boolean
  installing: boolean
  unavailable: boolean
  pending: boolean
  index: number
  onOpen: () => void
  onAdd: () => void
  onManage: () => void
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const hasGridDlc = game.dlc_app_ids.length > 0
  const { dlcIds, loading: dlcLoading } = useReleasedDlc(game.app_id, game.dlc_app_ids, inView && hasGridDlc)
  const dlcCount = hasGridDlc && !dlcLoading ? dlcIds.length : null

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.2) }}
      onClick={onOpen}
      className="group relative aspect-[460/215] cursor-pointer overflow-hidden rounded-xl border border-white/[0.06] transition-colors hover:border-white/[0.14]"
    >
      <SteamArt appId={game.app_id} headerUrl={game.header_url} pending={pending} className="h-full w-full" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pb-2.5 pt-12">
        <div className="min-w-0 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
          <p className="truncate text-[13px] font-bold text-white">{game.name}</p>
          <p className="text-[10px] font-medium text-white/55">
            App ID {game.app_id}
            {dlcCount !== null && dlcCount > 0 && ` · ${dlcCount} DLC`}
          </p>
        </div>
        {installed ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onManage()
            }}
            className="group/m flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-white/15 hover:text-neutral-100 active:scale-95"
          >
            <Check size={12} weight="bold" className="group-hover/m:hidden" />
            <span className="group-hover/m:hidden">Added</span>
            <span className="hidden group-hover/m:inline">Manage</span>
          </button>
        ) : installing ? (
          <button
            disabled
            className="flex shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold text-white"
          >
            <CircleNotch size={12} weight="bold" className="animate-spin" />
          </button>
        ) : unavailable ? (
          <span
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-red-300"
          >
            Unavailable
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-black/80 active:scale-95"
          >
            <DownloadSimple size={12} weight="bold" />
            Add
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function CatalogPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { games, steamPath, reload } = useLibrary()
  const { setRestartRequired, notify } = useInstaller()
  const installedIds = useMemo(() => new Set(games.map((g) => g.app_id)), [games])

  const markInstalled = useCallback(async () => {
    setRestartRequired(true)
    await reload()
  }, [setRestartRequired, reload])

  const [query, setQuery] = useState('')
  const [trending, setTrending] = useState<CatalogItem[]>([])
  const [results, setResults] = useState<CatalogItem[]>([])
  const [resultsFor, setResultsFor] = useState('')
  const [metaMap, setMetaMap] = useState<Map<number, AppMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DisplayGame | null>(null)
  const [installGame, setInstallGame] = useState<DisplayGame | null>(null)
  const [installingId, setInstallingId] = useState<number | null>(null)
  const [unavailable, setUnavailable] = useState<Set<number>>(new Set())

  const mergeMetas = (metas: AppMeta[]) =>
    setMetaMap((prev) => {
      const next = new Map(prev)
      metas.forEach((m) => next.set(m.app_id, m))
      return next
    })

  useEffect(() => {
    let alive = true
    catalogTrending()
      .then(async (items) => {
        if (!alive) return
        setTrending(items)
        const metas = await getAppsMeta(items.map((i) => i.app_id)).catch(() => [])
        if (!alive) return
        mergeMetas(metas)
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
    const q = query.trim()
    if (!q) return
    const timer = setTimeout(() => {
      catalogSearch(q)
        .then(async (items) => {
          const metas = await getAppsMeta(items.map((i) => i.app_id)).catch(() => [])
          setResults(items)
          mergeMetas(metas)
          setResultsFor(q)
        })
        .catch(() => {})
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const handleInstall = useCallback(
    async (appId: number): Promise<boolean> => {
      if (!steamPath) return false
      try {
        await catalogInstall(appId, steamPath)
        setRestartRequired(true)
        await reload()
        return true
      } catch {
        return false
      }
    },
    [steamPath, reload, setRestartRequired],
  )

  const handleInstallAt = useCallback(
    async (appId: number, sha: string): Promise<boolean> => {
      if (!steamPath) return false
      try {
        await catalogInstallAt(appId, steamPath, sha)
        setRestartRequired(true)
        await reload()
        return true
      } catch {
        return false
      }
    },
    [steamPath, reload, setRestartRequired],
  )

  const addToLibrary = useCallback(
    async (appId: number) => {
      setInstallingId(appId)
      const ok = await handleInstall(appId)
      setInstallingId(null)
      if (!ok) {
        setUnavailable((prev) => new Set(prev).add(appId))
        setTimeout(() => {
          setUnavailable((prev) => {
            const next = new Set(prev)
            next.delete(appId)
            return next
          })
        }, 3000)
      }
    },
    [handleInstall],
  )

  const handleAdd = (game: DisplayGame) => {
    if (!steamPath) {
      notify('error', 'Steam installation not found. Set your Steam path in Settings to install games.')
      return
    }
    if (game.dlc_app_ids.length > 0) setInstallGame(game)
    else addToLibrary(game.app_id)
  }

  const trimmed = query.trim()
  const isSearch = trimmed.length > 0
  const matched = isSearch && resultsFor === trimmed

  const displayGames = useMemo<DisplayGame[]>(() => {
    const rawItems = isSearch ? (matched ? results : []) : trending
    return rawItems
      .filter((it) => metaMap.get(it.app_id)?.kind !== 'dlc')
      .map((it) => {
        const meta = metaMap.get(it.app_id)
        const metaName = meta?.name
        const name = metaName && !/^App \d+$/.test(metaName) ? metaName : it.name
        return {
          app_id: it.app_id,
          name,
          header_url: meta?.header_url || it.header_url,
          dlc_app_ids: meta?.dlc_app_ids ?? [],
        }
      })
  }, [isSearch, matched, results, trending, metaMap])

  const showSpinner = isSearch ? !matched : loading
  const showEmpty = matched && results.length === 0

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="relative mb-5 shrink-0">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games or App ID…"
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

      {!steamPath && (
        <div className="mb-4 flex shrink-0 items-center gap-2.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-2.5 text-[12px] text-amber-200/90">
          <Warning size={15} weight="fill" className="shrink-0 text-amber-400" />
          Steam installation not found. Set your Steam path in Settings to install games.
        </div>
      )}

      <div className="mb-3 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-600">
          {isSearch ? 'Results' : 'Trending'}
        </span>
      </div>

      {showSpinner ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <CircleNotch size={22} className="animate-spin" />
          <p className="text-[13px] font-medium">{isSearch ? 'Searching…' : 'Loading trending…'}</p>
        </div>
      ) : showEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <MagnifyingGlass size={24} />
          <p className="text-[13px] font-medium">No games found</p>
        </div>
      ) : (
        <ScrollFade className="flex-1 pr-1" contentClassName="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 py-1">
          {displayGames.map((game, i) => (
            <CatalogCard
              key={game.app_id}
              game={game}
              installed={installedIds.has(String(game.app_id))}
              installing={installingId === game.app_id}
              unavailable={unavailable.has(game.app_id)}
              pending={!metaMap.has(game.app_id)}
              index={i}
              onOpen={() => setSelected(game)}
              onAdd={() => handleAdd(game)}
              onManage={() => onNavigate('Library')}
            />
          ))}
        </ScrollFade>
      )}

      {selected && (
        <CatalogDetailsModal
          key={selected.app_id}
          appId={selected.app_id}
          name={selected.name}
          headerUrl={selected.header_url}
          dlcAppIds={selected.dlc_app_ids}
          installedIds={installedIds}
          steamPath={steamPath}
          onClose={() => setSelected(null)}
          onInstall={handleInstall}
          onInstallAt={handleInstallAt}
          onInstalled={markInstalled}
          onSelectInstall={() => setInstallGame(selected)}
        />
      )}

      {installGame && (
        <InstallSelectModal
          appId={installGame.app_id}
          name={installGame.name}
          dlcAppIds={installGame.dlc_app_ids}
          installedIds={installedIds}
          steamPath={steamPath}
          onClose={() => setInstallGame(null)}
          onInstalled={markInstalled}
        />
      )}
    </div>
  )
}
