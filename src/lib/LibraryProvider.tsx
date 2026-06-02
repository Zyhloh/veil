import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  getSteamPath,
  listInstalledGames,
  getAppsMeta,
  type InstalledGame,
  type AppMeta,
} from './library'
import { LibraryContext } from './library-context'

async function fetchAll(path: string) {
  const list = await listInstalledGames(path).catch(() => [] as InstalledGame[])
  const fetched = await getAppsMeta(list.map((g) => Number(g.app_id))).catch(() => [] as AppMeta[])
  return { list, metas: new Map(fetched.map((m) => [String(m.app_id), m])) }
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [steamPath, setSteamPath] = useState<string | null>(null)
  const [games, setGames] = useState<InstalledGame[]>([])
  const [metas, setMetas] = useState<Map<string, AppMeta>>(new Map())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    getSteamPath()
      .catch(() => '')
      .then(async (path) => {
        if (!alive) return
        setSteamPath(path)
        if (path) {
          const data = await fetchAll(path)
          if (!alive) return
          setGames(data.list)
          setMetas(data.metas)
        }
        setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const reload = useCallback(async () => {
    const path = steamPath ?? (await getSteamPath().catch(() => ''))
    if (!path) return
    const data = await fetchAll(path)
    setGames(data.list)
    setMetas(data.metas)
  }, [steamPath])

  const updateSteamPath = useCallback(async (path: string) => {
    setSteamPath(path)
    if (!path) {
      setGames([])
      setMetas(new Map())
      return
    }
    const data = await fetchAll(path)
    setGames(data.list)
    setMetas(data.metas)
  }, [])

  return (
    <LibraryContext.Provider value={{ steamPath, games, metas, ready, reload, setSteamPath: updateSteamPath }}>
      {children}
    </LibraryContext.Provider>
  )
}
