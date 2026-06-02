import { createContext, useContext } from 'react'
import type { InstalledGame, AppMeta } from './library'

export interface LibraryValue {
  steamPath: string | null
  games: InstalledGame[]
  metas: Map<string, AppMeta>
  ready: boolean
  reload: () => Promise<void>
  setSteamPath: (path: string) => Promise<void>
}

export const LibraryContext = createContext<LibraryValue | null>(null)

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used within LibraryProvider')
  return value
}
