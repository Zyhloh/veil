import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { Library, Trash2, Loader2, ChevronDown, Package } from 'lucide-react'

interface InstalledGame {
  game_id: string
  game_name: string
  manifest_count: number
}

interface GameInfo {
  name: string
  headerUrl: string
  type: string // "Game", "DLC", "Tool", etc.
  parentAppId: string // For DLCs, the parent game's app ID
  dlcAppIds: string[] // For base games, list of DLC app IDs
}

interface GameGroup {
  base: InstalledGame
  dlcs: InstalledGame[]
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

const gameInfoCache = new Map<string, GameInfo>()

async function checkImageExists(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    return resp.ok
  } catch {
    return false
  }
}

async function fetchGameInfo(appId: string): Promise<GameInfo> {
  if (gameInfoCache.has(appId)) return gameInfoCache.get(appId)!

  let name = `App ${appId}`
  let headerUrl = ''
  let type = 'Game'
  let parentAppId = ''
  let dlcAppIds: string[] = []

  try {
    const resp = await fetch(`https://api.steamcmd.net/v1/info/${appId}`)
    const json = await resp.json()
    const appData = json?.data?.[appId]
    name = appData?.common?.name || name
    type = appData?.common?.type || type
    parentAppId = appData?.common?.parent || ''

    const dlcStr = appData?.extended?.listofdlc || ''
    dlcAppIds = dlcStr
      ? dlcStr.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      : []

    const headerHash = appData?.common?.header_image?.english || appData?.common?.header_image
    if (headerHash && typeof headerHash === 'string') {
      headerUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${headerHash}`
    }
  } catch {}

  if (!headerUrl) {
    const fallbacks = [
      `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
    ]
    for (const url of fallbacks) {
      if (await checkImageExists(url)) {
        headerUrl = url
        break
      }
    }
  }

  const info: GameInfo = { name, headerUrl, type, parentAppId, dlcAppIds }
  gameInfoCache.set(appId, info)
  return info
}

function groupGamesWithDlc(
  games: InstalledGame[],
  infos: Map<string, GameInfo>
): GameGroup[] {
  const gameMap = new Map<string, InstalledGame>()
  for (const g of games) gameMap.set(g.game_id, g)

  const dlcToParent = new Map<string, string>()
  const parentDlcs = new Map<string, Set<string>>()

  // First pass: identify DLCs via their own parentAppId
  for (const g of games) {
    const info = infos.get(g.game_id)
    if (!info) continue

    if (info.type === 'DLC' || info.type === 'dlc') {
      if (info.parentAppId && gameMap.has(info.parentAppId)) {
        dlcToParent.set(g.game_id, info.parentAppId)
        if (!parentDlcs.has(info.parentAppId)) parentDlcs.set(info.parentAppId, new Set())
        parentDlcs.get(info.parentAppId)!.add(g.game_id)
      }
    }
  }

  // Second pass: check base games' dlcAppIds for installed DLCs not yet assigned
  for (const g of games) {
    const info = infos.get(g.game_id)
    if (!info || info.dlcAppIds.length === 0) continue

    for (const dlcId of info.dlcAppIds) {
      if (gameMap.has(dlcId) && !dlcToParent.has(dlcId)) {
        dlcToParent.set(dlcId, g.game_id)
        if (!parentDlcs.has(g.game_id)) parentDlcs.set(g.game_id, new Set())
        parentDlcs.get(g.game_id)!.add(dlcId)
      }
    }
  }

  const groups: GameGroup[] = []
  const handled = new Set<string>()

  // Build groups: base games first, then ungrouped items
  for (const g of games) {
    if (handled.has(g.game_id)) continue
    if (dlcToParent.has(g.game_id)) continue // Skip DLCs, they'll be nested

    const dlcIds = parentDlcs.get(g.game_id)
    const dlcs: InstalledGame[] = []
    if (dlcIds) {
      for (const dlcId of dlcIds) {
        const dlcGame = gameMap.get(dlcId)
        if (dlcGame) {
          dlcs.push(dlcGame)
          handled.add(dlcId)
        }
      }
      // Sort DLCs by name
      dlcs.sort((a, b) => {
        const nameA = infos.get(a.game_id)?.name || a.game_id
        const nameB = infos.get(b.game_id)?.name || b.game_id
        return nameA.localeCompare(nameB)
      })
    }

    groups.push({ base: g, dlcs })
    handled.add(g.game_id)
  }

  // Any DLCs whose parent isn't installed get shown as standalone
  for (const g of games) {
    if (!handled.has(g.game_id)) {
      groups.push({ base: g, dlcs: [] })
    }
  }

  return groups
}

function GameCard({
  game,
  info,
  onUninstall,
  isUninstalling,
  isDlc,
}: {
  game: InstalledGame
  info: GameInfo | undefined
  onUninstall: () => void
  isUninstalling: boolean
  isDlc?: boolean
}) {
  return (
    <div className={`flex items-center gap-4 ${isDlc ? 'p-2.5 pl-4' : 'p-3'}`}>
      <div className={`${isDlc ? 'w-[88px] h-[41px]' : 'w-[120px] h-[56px]'} rounded-lg bg-white/5 overflow-hidden shrink-0 flex items-center justify-center`}>
        {info?.headerUrl ? (
          <img
            src={info.headerUrl}
            alt={info.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <span className={`text-white/15 ${isDlc ? 'text-[11px]' : 'text-[14px]'} font-bold tracking-wide`}>
            {(info?.name || game.game_id).split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isDlc && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[9px] font-semibold uppercase tracking-wider shrink-0">
              DLC
            </span>
          )}
          <p className={`${isDlc ? 'text-[12px] text-white/70' : 'text-[13px] text-white/90'} font-semibold truncate`}>
            {info?.name || `App ${game.game_id}`}
          </p>
        </div>
        <p className={`${isDlc ? 'text-[10px]' : 'text-[11px]'} text-white/30 mt-0.5`}>App ID: {game.game_id}</p>
        {!isDlc && (
          <p className="text-[11px] text-white/20 mt-0.5">
            {game.manifest_count} manifest{game.manifest_count !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onUninstall() }}
        disabled={isUninstalling}
        className={`${isDlc ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all duration-200 bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed shrink-0`}
      >
        {isUninstalling ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Trash2 size={isDlc ? 11 : 12} strokeWidth={1.5} />
        )}
        {!isDlc && (isUninstalling ? 'Removing...' : 'Uninstall')}
      </button>
    </div>
  )
}

function GameGroupCard({
  group,
  gameInfos,
  uninstallingId,
  onUninstall,
  index,
}: {
  group: GameGroup
  gameInfos: Map<string, GameInfo>
  uninstallingId: string | null
  onUninstall: (gameId: string) => void
  index: number
}) {
  const [expanded, setExpanded] = useState(false)
  const info = gameInfos.get(group.base.game_id)
  const hasDlc = group.dlcs.length > 0

  return (
    <motion.div
      key={group.base.game_id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.04, ease: EASE }}
      className="veil-card rounded-xl overflow-hidden group"
    >
      {/* Base game row */}
      <div
        className={`flex items-center gap-4 ${hasDlc ? 'cursor-pointer hover:bg-white/[0.02] transition-colors duration-150' : ''}`}
        onClick={() => hasDlc && setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <GameCard
            game={group.base}
            info={info}
            onUninstall={() => onUninstall(group.base.game_id)}
            isUninstalling={uninstallingId === group.base.game_id}
          />
        </div>
        {hasDlc && (
          <div className="flex items-center gap-2 pr-3 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10">
              <Package size={11} className="text-purple-400/70" />
              <span className="text-[11px] font-medium text-purple-400/90">
                {group.dlcs.length} DLC{group.dlcs.length !== 1 ? 's' : ''}
              </span>
            </div>
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={14} className="text-white/25" />
            </motion.div>
          </div>
        )}
      </div>

      {/* DLC dropdown */}
      <AnimatePresence>
        {expanded && hasDlc && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.04] mx-3" />
            <div className="py-1">
              {group.dlcs.map((dlc) => {
                const dlcInfo = gameInfos.get(dlc.game_id)
                return (
                  <div
                    key={dlc.game_id}
                    className="hover:bg-white/[0.02] transition-colors duration-100"
                  >
                    <GameCard
                      game={dlc}
                      info={dlcInfo}
                      onUninstall={() => onUninstall(dlc.game_id)}
                      isUninstalling={uninstallingId === dlc.game_id}
                      isDlc
                    />
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function LibraryPage() {
  const [games, setGames] = useState<InstalledGame[]>([])
  const [gameInfos, setGameInfos] = useState<Map<string, GameInfo>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [uninstallingId, setUninstallingId] = useState<string | null>(null)

  const loadGames = useCallback(async () => {
    try {
      const config = await invoke<{ steam_path: string }>('get_app_config')
      if (!config.steam_path) return
      const list = await invoke<InstalledGame[]>('list_installed_games', { steamPath: config.steam_path })
      setGames(list)

      const infos = new Map<string, GameInfo>(gameInfoCache)
      const toFetch = list.filter(g => !infos.has(g.game_id))

      const results = await Promise.all(toFetch.map(g => fetchGameInfo(g.game_id)))
      toFetch.forEach((g, i) => infos.set(g.game_id, results[i]))
      setGameInfos(new Map(infos))
    } catch {
      setGames([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGames()
  }, [loadGames])

  const handleUninstall = async (gameId: string) => {
    setUninstallingId(gameId)
    try {
      const config = await invoke<{ steam_path: string }>('get_app_config')
      await invoke('uninstall_game', { steamPath: config.steam_path, gameId })
      await loadGames()
    } catch {}
    setUninstallingId(null)
  }

  const groups = groupGamesWithDlc(games, gameInfos)
  const baseGameCount = groups.length
  const dlcCount = groups.reduce((sum, g) => sum + g.dlcs.length, 0)

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Loader2 size={24} className="text-white/30 animate-spin" />
        <p className="text-white/30 text-[13px] font-medium">Loading library...</p>
      </div>
    )
  }

  if (games.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-6"
        >
          <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">Library</h1>
          <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
            View and manage your installed manifests
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
          className="veil-card flex-1 flex flex-col items-center justify-center gap-4 rounded-2xl"
        >
          <div className="veil-icon-box w-11 h-11 rounded-xl flex items-center justify-center">
            <Library size={18} strokeWidth={1.5} className="text-white/40" />
          </div>
          <div className="text-center">
            <p className="text-white/70 text-[14px] font-medium">No manifests installed</p>
            <p className="text-white/25 text-[12px] mt-1.5">Install some manifests to see them here</p>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-6"
      >
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">Library</h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          {baseGameCount} app{baseGameCount !== 1 ? 's' : ''} installed
          {dlcCount > 0 && (
            <span className="text-purple-400/50">
              {' '}&middot; {dlcCount} DLC{dlcCount !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </motion.div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <AnimatePresence>
          {groups.map((group, i) => (
            <GameGroupCard
              key={group.base.game_id}
              group={group}
              gameInfos={gameInfos}
              uninstallingId={uninstallingId}
              onUninstall={handleUninstall}
              index={i}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default LibraryPage
