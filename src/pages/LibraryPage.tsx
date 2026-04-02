import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { Library, Trash2, Loader2 } from 'lucide-react'

interface InstalledGame {
  game_id: string
  game_name: string
  manifest_count: number
}

interface GameInfo {
  name: string
  headerUrl: string
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

const gameInfoCache = new Map<string, GameInfo>()

async function fetchGameInfo(appId: string): Promise<GameInfo> {
  if (gameInfoCache.has(appId)) return gameInfoCache.get(appId)!

  const headerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`

  try {
    const resp = await fetch(`https://api.steamcmd.net/v1/info/${appId}`)
    const json = await resp.json()
    const name = json?.data?.[appId]?.common?.name || `App ${appId}`
    const info = { name, headerUrl }
    gameInfoCache.set(appId, info)
    return info
  } catch {
    const info = { name: `App ${appId}`, headerUrl }
    gameInfoCache.set(appId, info)
    return info
  }
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
          {games.length} game{games.length !== 1 ? 's' : ''} installed
        </p>
      </motion.div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <AnimatePresence>
          {games.map((game, i) => {
            const info = gameInfos.get(game.game_id)
            return (
              <motion.div
                key={game.game_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.04, ease: EASE }}
                className="veil-card rounded-xl overflow-hidden group"
              >
                <div className="flex items-center gap-4 p-3">
                  <div className="w-[120px] h-[56px] rounded-lg bg-white/5 overflow-hidden shrink-0">
                    {info?.headerUrl && (
                      <img
                        src={info.headerUrl}
                        alt={info.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white/90 font-semibold truncate">
                      {info?.name || `App ${game.game_id}`}
                    </p>
                    <p className="text-[11px] text-white/30 mt-0.5">App ID: {game.game_id}</p>
                    <p className="text-[11px] text-white/20 mt-0.5">
                      {game.manifest_count} manifest{game.manifest_count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUninstall(game.game_id)}
                    disabled={uninstallingId === game.game_id}
                    className="px-3 py-2 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all duration-200 bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {uninstallingId === game.game_id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} strokeWidth={1.5} />
                    )}
                    {uninstallingId === game.game_id ? 'Removing...' : 'Uninstall'}
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default LibraryPage
