import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return fallback
}
import {
  Search,
  Loader2,
  Check,
  Download,
  Package,
  X,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'

function monogram(name: string): string {
  const skip = new Set([
    'the',
    'of',
    'a',
    'an',
    'and',
    'to',
    'in',
    'for',
    'on',
  ])
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()))
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface CatalogSearchItem {
  app_id: number
  name: string
  header_url: string
  kind: string
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

const gridVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: EASE },
  },
}

type CardStatus = 'idle' | 'installing' | 'installed' | 'error'

interface CatalogCardProps {
  item: CatalogSearchItem
  status: CardStatus
  onInstall: (appId: number) => void
}

const CatalogCard = memo(function CatalogCard({
  item,
  status,
  onInstall,
}: CatalogCardProps) {
  const [imgOk, setImgOk] = useState(true)
  const installing = status === 'installing'
  const installed = status === 'installed'
  const errored = status === 'error'

  return (
    <motion.div variants={cardVariants} className="veil-game-card rounded-2xl">
      {imgOk ? (
        <img
          src={item.header_url}
          alt={item.name}
          className="game-art"
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      ) : (
        <div
          className="game-art relative flex items-center justify-center overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08), rgba(255,255,255,0.015) 60%), linear-gradient(135deg, #17171b 0%, #0c0c0f 100%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 1px, transparent 8px)',
            }}
          />
          <span
            className="font-bold text-white/70 tracking-[-0.04em] select-none"
            style={{
              fontSize: 'clamp(32px, 18%, 64px)',
              textShadow: '0 2px 20px rgba(0,0,0,0.8)',
              lineHeight: 1,
            }}
          >
            {monogram(item.name)}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className="text-white font-semibold text-[12.5px] tracking-[-0.01em] truncate"
            style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
            title={item.name}
          >
            {item.name}
          </p>
          <p className="text-white/55 text-[10.5px] font-mono mt-0.5">
            {item.app_id}
            {item.kind && item.kind !== 'app' && item.kind !== 'game' && (
              <span className="ml-2 uppercase tracking-wider text-white/40">
                {item.kind}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => onInstall(item.app_id)}
          disabled={installing || installed}
          className="veil-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          {installing ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              Adding
            </>
          ) : installed ? (
            <>
              <Check size={11} strokeWidth={2.5} />
              Added
            </>
          ) : errored ? (
            <>
              <AlertTriangle size={11} strokeWidth={2} />
              Retry
            </>
          ) : (
            <>
              <Download size={11} strokeWidth={2} />
              Add
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
})

function CatalogPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMap, setStatusMap] = useState<Map<number, CardStatus>>(
    new Map(),
  )
  const [installedSet, setInstalledSet] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const steamPathRef = useRef<string>('')
  const reqIdRef = useRef(0)

  useEffect(() => {
    invoke<{ steam_path: string }>('get_app_config')
      .then((cfg) => {
        steamPathRef.current = cfg.steam_path || ''
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const trimmed = query.trim()

    if (!trimmed) {
      setResults([])
      setHasSearched(false)
      setSearching(false)
      setError(null)
      return
    }

    const myId = ++reqIdRef.current
    setSearching(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const items = await invoke<CatalogSearchItem[]>('catalog_search', {
          query: trimmed,
        })
        if (reqIdRef.current !== myId) return
        setResults(items)
        setHasSearched(true)

        if (steamPathRef.current && items.length > 0) {
          const checks = await Promise.all(
            items.map((it) =>
              invoke<boolean>('catalog_is_installed', {
                appId: it.app_id,
                steamPath: steamPathRef.current,
              }).catch(() => false),
            ),
          )
          if (reqIdRef.current !== myId) return
          const set = new Set<number>()
          items.forEach((it, i) => {
            if (checks[i]) set.add(it.app_id)
          })
          setInstalledSet((prev) => {
            const merged = new Set(prev)
            set.forEach((id) => merged.add(id))
            return merged
          })
        }
      } catch (e: unknown) {
        if (reqIdRef.current !== myId) return
        console.error('catalog_search failed', e)
        setError(errorMessage(e, 'Search failed'))
        setResults([])
        setHasSearched(true)
      } finally {
        if (reqIdRef.current === myId) setSearching(false)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [query])

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 4500)
    },
    [],
  )

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const handleInstall = useCallback(
    async (appId: number) => {
      if (!steamPathRef.current) {
        try {
          const cfg = await invoke<{ steam_path: string }>('get_app_config')
          steamPathRef.current = cfg.steam_path || ''
        } catch {}
      }
      if (!steamPathRef.current) {
        showToast('error', 'Steam path not configured')
        return
      }
      setStatusMap((m) => {
        const next = new Map(m)
        next.set(appId, 'installing')
        return next
      })
      try {
        await invoke('catalog_install_lua', {
          appId,
          steamPath: steamPathRef.current,
        })
        setInstalledSet((s) => {
          const next = new Set(s)
          next.add(appId)
          return next
        })
        setStatusMap((m) => {
          const next = new Map(m)
          next.set(appId, 'installed')
          return next
        })
        const found = results.find((r) => r.app_id === appId)
        showToast(
          'success',
          `Added ${found?.name || `App ${appId}`} — restart Steam to load`,
        )
      } catch (e: unknown) {
        console.error('catalog_install_lua failed', e)
        setStatusMap((m) => {
          const next = new Map(m)
          next.set(appId, 'error')
          return next
        })
        showToast('error', errorMessage(e, `Failed to add app ${appId}`))
      }
    },
    [showToast, results],
  )

  const getStatus = (id: number): CardStatus => {
    const s = statusMap.get(id)
    if (s) return s
    return installedSet.has(id) ? 'installed' : 'idle'
  }

  const isEmptyState = !query.trim()
  const noResults = !isEmptyState && !searching && hasSearched && !error && results.length === 0

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-5 shrink-0"
      >
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">
          Catalog
        </h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          Search Steam for a game or DLC to add instantly
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.05 }}
        className="shrink-0 mb-4"
      >
        <div className="veil-glass-input rounded-2xl flex items-center gap-3 px-4 py-3 min-w-0">
          <motion.div
            animate={{ rotate: searching ? 360 : 0 }}
            transition={
              searching
                ? { duration: 1.1, ease: 'linear', repeat: Infinity }
                : { duration: 0.2 }
            }
            className="shrink-0"
          >
            {searching ? (
              <Loader2 size={15} className="text-white/50" />
            ) : (
              <Search size={15} className="text-white/35" />
            )}
          </motion.div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try Palworld, Elden Ring, or 189375"
            className="flex-1 bg-transparent outline-none text-white text-[13.5px] placeholder:text-white/25 min-w-0"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all shrink-0"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </motion.div>

      <div className="relative flex-1 min-h-0 min-w-0">
        <AnimatePresence mode="wait">
          {isEmptyState && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center px-6"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: 0.6,
                  ease: EASE,
                  delay: 0.1,
                }}
                className="relative"
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow:
                      'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 20px 50px -20px rgba(0,0,0,0.6)',
                  }}
                >
                  <Sparkles
                    size={24}
                    strokeWidth={1.4}
                    className="text-white/60"
                  />
                </div>
                <motion.div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  animate={{
                    boxShadow: [
                      '0 0 0 0 rgba(255,255,255,0.08)',
                      '0 0 0 14px rgba(255,255,255,0)',
                    ],
                  }}
                  transition={{
                    duration: 2.4,
                    ease: 'easeOut',
                    repeat: Infinity,
                  }}
                />
              </motion.div>
              <div className="max-w-sm">
                <p className="text-white/75 font-semibold text-[14px] tracking-[-0.01em]">
                  Search to get started
                </p>
                <p className="text-white/35 text-[12px] mt-1.5 leading-relaxed">
                  Type a game or DLC name, or paste a Steam AppID. Results load
                  on demand — nothing is fetched until you search.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                {['Palworld', 'Elden Ring', 'Baldur\u2019s Gate 3', '189375'].map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="veil-glass rounded-xl px-3 py-1.5 text-[11px] text-white/60 hover:text-white font-medium transition-colors"
                    >
                      {s}
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          )}

          {!isEmptyState && searching && results.length === 0 && (
            <motion.div
              key="searching"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            >
              <motion.div
                animate={{
                  scale: [1, 1.08, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1.4,
                  ease: 'easeInOut',
                  repeat: Infinity,
                }}
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Search size={18} strokeWidth={1.5} className="text-white/60" />
              </motion.div>
              <p className="text-white/40 text-[12.5px] font-medium">
                Searching Steam…
              </p>
            </motion.div>
          )}

          {error && !searching && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
            >
              <div className="veil-icon-box w-11 h-11 rounded-xl flex items-center justify-center">
                <AlertTriangle
                  size={18}
                  strokeWidth={1.5}
                  className="text-amber-400"
                />
              </div>
              <p className="text-white/70 text-[13px] font-medium">
                Search failed
              </p>
              <p className="text-white/30 text-[11px] max-w-sm">{error}</p>
            </motion.div>
          )}

          {noResults && (
            <motion.div
              key="no-results"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/30 text-center px-6"
            >
              <Package size={34} strokeWidth={1.1} />
              <p className="text-[13px] font-medium text-white/55">
                No results for &ldquo;{query.trim()}&rdquo;
              </p>
              <p className="text-[11px] max-w-sm">
                Try a different name, or paste the Steam AppID directly.
              </p>
            </motion.div>
          )}

          {!isEmptyState && !error && results.length > 0 && (
            <motion.div
              key={`results-${query.trim()}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0"
              style={{
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
                maskImage:
                  'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
              }}
            >
              <div className="absolute inset-0 overflow-y-auto overflow-x-hidden pr-2 pt-3 pb-3">
                <motion.div
                  variants={gridVariants}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-2 xl:grid-cols-3 gap-3 pb-2"
                >
                  {results.map((item) => (
                    <CatalogCard
                      key={item.app_id}
                      item={item}
                      status={getStatus(item.app_id)}
                      onInstall={handleInstall}
                    />
                  ))}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{
              type: 'spring',
              stiffness: 320,
              damping: 30,
              mass: 0.8,
            }}
            className="fixed bottom-6 right-6 z-40 max-w-sm rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{
              background: '#0d0d10',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow:
                'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 20px 50px -15px rgba(0,0,0,0.8)',
            }}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                toast.type === 'success'
                  ? 'bg-emerald-400/10 text-emerald-400'
                  : 'bg-amber-400/10 text-amber-400'
              }`}
            >
              {toast.type === 'success' ? (
                <Check size={14} strokeWidth={2.5} />
              ) : (
                <AlertTriangle size={14} strokeWidth={2} />
              )}
            </div>
            <p className="text-white text-[12.5px] font-medium flex-1 min-w-0">
              {toast.message}
            </p>
            <button
              onClick={() => setToast(null)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-all shrink-0"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default CatalogPage
