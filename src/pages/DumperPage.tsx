import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  KeyRound,
  LogOut,
  Search,
  Download,
  Loader2,
  ShieldCheck,
  Smartphone,
  AlertCircle,
  CheckCircle,
  Package,
  User,
  X,
} from 'lucide-react'

interface OwnedGame {
  app_id: number
  name: string
  playtime: number
}

interface LoginResult {
  via: string
  refresh_token: string
}

interface StatusResult {
  logged_in: boolean
  steam_id: string | null
}

interface DumpResult {
  app_id: number
  app_name: string
  output_dir: string
  depots_dumped: number
  depots_failed: number
  files: string[]
  errors: string[]
}

type Phase =
  | 'logged-out'
  | 'logging-in'
  | 'awaiting-code'
  | 'awaiting-device'
  | 'logged-in'

const EASE = [0.25, 0.46, 0.45, 0.94] as const
const SPRING = { type: 'spring' as const, stiffness: 280, damping: 28 }
const TOKEN_KEY = 'veil.dumper.refresh_token'

interface GameArtInfo {
  headerUrl: string
}

const artCache = new Map<number, GameArtInfo>()
const artInflight = new Map<number, Promise<GameArtInfo>>()

async function checkImageExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return r.ok
  } catch {
    return false
  }
}

async function fetchGameArt(appId: number): Promise<GameArtInfo> {
  const cached = artCache.get(appId)
  if (cached) return cached
  const inflight = artInflight.get(appId)
  if (inflight) return inflight

  const promise = (async () => {
    let headerUrl = ''
    try {
      const resp = await fetch(`https://api.steamcmd.net/v1/info/${appId}`)
      const json = await resp.json()
      const appData = json?.data?.[appId]
      const headerHash =
        appData?.common?.header_image?.english || appData?.common?.header_image
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

    const info = { headerUrl }
    artCache.set(appId, info)
    return info
  })()

  artInflight.set(appId, promise)
  try {
    return await promise
  } finally {
    artInflight.delete(appId)
  }
}

function GameArt({ appId, name }: { appId: number; name: string }) {
  const [url, setUrl] = useState<string>(() => artCache.get(appId)?.headerUrl ?? '')
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (url) return
    fetchGameArt(appId).then((info) => {
      if (cancelled) return
      if (info.headerUrl) setUrl(info.headerUrl)
      else setErrored(true)
    })
    return () => {
      cancelled = true
    }
  }, [appId, url])

  return (
    <div className="relative w-full aspect-[460/215] overflow-hidden bg-white/[0.03]">
      {!loaded && !errored && <div className="absolute inset-0 veil-shimmer" />}
      {url && !errored && (
        <img
          src={url}
          alt={name}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`game-art absolute inset-0 w-full h-full object-cover ${
            loaded ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-500`}
        />
      )}
      {errored && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Package size={28} strokeWidth={1} className="text-white/15" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
    </div>
  )
}

interface SteamProfile {
  avatar_url: string | null
  persona_name: string | null
}

const profileCache = new Map<string, SteamProfile>()

async function fetchSteamProfile(steamId: string): Promise<SteamProfile> {
  const cached = profileCache.get(steamId)
  if (cached) return cached
  try {
    const p = await invoke<SteamProfile>('dumper_get_profile', { steamId })
    profileCache.set(steamId, p)
    return p
  } catch {
    return { avatar_url: null, persona_name: null }
  }
}

function DumperPage() {
  const [phase, setPhase] = useState<Phase>('logged-out')
  const [silentLogin, setSilentLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [guardCode, setGuardCode] = useState('')
  const [guardIsEmail, setGuardIsEmail] = useState(false)
  const [error, setError] = useState('')
  const [steamId, setSteamId] = useState<string | null>(null)
  const [profile, setProfile] = useState<SteamProfile | null>(null)

  const [games, setGames] = useState<OwnedGame[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [dumpingId, setDumpingId] = useState<number | null>(null)
  const [lastDump, setLastDump] = useState<DumpResult | null>(null)

  const triedSilentLogin = useRef(false)

  useEffect(() => {
    if (!lastDump) return
    const t = setTimeout(() => setLastDump(null), 5000)
    return () => clearTimeout(t)
  }, [lastDump])

  useEffect(() => {
    if (!steamId) {
      setProfile(null)
      return
    }
    let cancelled = false
    fetchSteamProfile(steamId).then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => {
      cancelled = true
    }
  }, [steamId])

  const refreshGames = useCallback(async () => {
    setGamesLoading(true)
    try {
      const res = await invoke<{ games: OwnedGame[] }>('dumper_owned_games')
      const sorted = [...res.games].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      setGames(sorted)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGamesLoading(false)
    }
  }, [])

  const finalizeLogin = useCallback(
    async (result: LoginResult) => {
      if (result.refresh_token) {
        try {
          localStorage.setItem(TOKEN_KEY, result.refresh_token)
        } catch {}
      }
      setPassword('')
      setGuardCode('')
      setError('')
      setSilentLogin(false)
      setPhase('logged-in')
      try {
        const s = await invoke<StatusResult>('dumper_status')
        setSteamId(s.steam_id)
      } catch {}
      refreshGames()
    },
    [refreshGames]
  )

  useEffect(() => {
    if (triedSilentLogin.current) return
    triedSilentLogin.current = true

    const saved = (() => {
      try {
        return localStorage.getItem(TOKEN_KEY)
      } catch {
        return null
      }
    })()
    if (!saved) return

    ;(async () => {
      setSilentLogin(true)
      setPhase('logging-in')
      try {
        const res = await invoke<LoginResult>('dumper_login', {
          refreshToken: saved,
        })
        await finalizeLogin(res)
      } catch {
        try {
          localStorage.removeItem(TOKEN_KEY)
        } catch {}
        setSilentLogin(false)
        setPhase('logged-out')
      }
    })()
  }, [finalizeLogin])

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = []

    unlisteners.push(
      listen('dumper:needs_steam_guard', (event) => {
        const payload = event.payload as { is_email?: boolean } | undefined
        setGuardIsEmail(!!payload?.is_email)
        setSilentLogin(false)
        setPhase('awaiting-code')
      })
    )
    unlisteners.push(
      listen('dumper:needs_device_confirmation', () => {
        setSilentLogin(false)
        setPhase('awaiting-device')
      })
    )
    unlisteners.push(
      listen('dumper:terminated', () => {
        setSilentLogin(false)
        setPhase('logged-out')
        setError('Dumper service stopped unexpectedly.')
      })
    )

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setError('')
    setSilentLogin(false)
    setPhase('logging-in')
    try {
      const res = await invoke<LoginResult>('dumper_login', {
        username,
        password,
      })
      await finalizeLogin(res)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('logged-out')
    }
  }

  const handleSubmitGuard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guardCode) return
    setError('')
    setPhase('logging-in')
    try {
      await invoke('dumper_submit_guard', { code: guardCode })
      const s = await invoke<StatusResult>('dumper_status')
      if (s.logged_in) {
        setSteamId(s.steam_id)
        setPhase('logged-in')
        refreshGames()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('awaiting-code')
    }
  }

  const handleLogout = async () => {
    try {
      await invoke('dumper_logout')
    } catch {}
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {}
    setPhase('logged-out')
    setSteamId(null)
    setProfile(null)
    setGames([])
    setUsername('')
    setPassword('')
  }

  const handleDump = async (game: OwnedGame) => {
    setDumpingId(game.app_id)
    setError('')
    setLastDump(null)
    try {
      const res = await invoke<DumpResult>('dumper_dump_app', {
        appId: game.app_id,
      })
      setLastDump(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDumpingId(null)
    }
  }

  const filteredGames = useMemo(() => {
    if (!query) return games
    const q = query.toLowerCase()
    return games.filter(
      (g) => g.name.toLowerCase().includes(q) || String(g.app_id).includes(q)
    )
  }, [games, query])

  const showSilentLoader = silentLogin && phase === 'logging-in'
  const showLoginForm = !showSilentLoader && (phase === 'logged-out' || phase === 'logging-in')

  return (
    <div className="relative h-full flex flex-col overflow-hidden min-w-0">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="relative mb-6 min-w-0"
      >
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">
          Manifest Dumper
        </h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          Sign in with a Steam account to dump manifests for the games you own
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {showSilentLoader && (
          <motion.div
            key="silent"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            className="relative flex-1 flex items-center justify-center"
          >
            <div className="veil-glass rounded-[28px] p-10 w-full max-w-[380px] flex flex-col items-center text-center">
              <div className="relative w-20 h-20 mb-5">
                <div
                  className="absolute inset-0 rounded-3xl veil-pulse"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)',
                    filter: 'blur(14px)',
                  }}
                />
                <div
                  className="relative w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 32px -8px rgba(0,0,0,0.5)',
                  }}
                >
                  <Loader2 size={26} strokeWidth={1.8} className="text-white animate-spin" />
                </div>
              </div>
              <p className="text-white font-semibold text-[16px] tracking-[-0.02em]">
                Restoring session
              </p>
              <p className="text-white/40 text-[12px] mt-1.5 max-w-[260px]">
                Signing back in with your saved Steam token
              </p>
            </div>
          </motion.div>
        )}

        {showLoginForm && (
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={SPRING}
            className="relative flex-1 flex items-center justify-center"
          >
            <div className="veil-glass rounded-[28px] p-8 w-full max-w-[420px]">
              <div className="flex flex-col items-center text-center mb-6">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...SPRING, delay: 0.05 }}
                  className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 32px -8px rgba(0,0,0,0.5)',
                  }}
                >
                  <KeyRound size={22} strokeWidth={1.5} className="text-white" />
                </motion.div>
                <p className="text-white font-semibold text-[17px] tracking-[-0.02em]">
                  Sign in to Steam
                </p>
                <p className="text-white/40 text-[12px] mt-1.5 max-w-[280px]">
                  Credentials go directly to Steam. Nothing is stored on disk.
                </p>
              </div>

              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={phase === 'logging-in'}
                  className="veil-glass-input px-4 py-3 rounded-2xl text-[13.5px] text-white placeholder:text-white/30 outline-none"
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={phase === 'logging-in'}
                  className="veil-glass-input px-4 py-3 rounded-2xl text-[13.5px] text-white placeholder:text-white/30 outline-none"
                />

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={{ opacity: 0, y: -4, height: 0 }}
                      className="flex items-start gap-2 text-red-300/90 text-[12px] px-1 overflow-hidden"
                    >
                      <AlertCircle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={phase === 'logging-in' || !username || !password}
                  className="veil-btn-primary mt-2 py-3 rounded-2xl text-[13.5px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {phase === 'logging-in' ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Signing in
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {phase === 'awaiting-code' && (
          <motion.div
            key="code"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={SPRING}
            className="relative flex-1 flex items-center justify-center"
          >
            <div className="veil-glass rounded-[28px] p-8 w-full max-w-[420px]">
              <div className="flex flex-col items-center text-center mb-6">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
                  }}
                >
                  <ShieldCheck size={22} strokeWidth={1.5} className="text-white" />
                </div>
                <p className="text-white font-semibold text-[17px] tracking-[-0.02em]">
                  Two-factor required
                </p>
                <p className="text-white/40 text-[12px] mt-1.5 max-w-[280px]">
                  {guardIsEmail
                    ? 'Check your email for the verification code'
                    : 'Open the Steam Mobile app and enter the displayed code'}
                </p>
              </div>

              <form onSubmit={handleSubmitGuard} className="flex flex-col gap-3">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  value={guardCode}
                  onChange={(e) => setGuardCode(e.target.value.trim().toUpperCase())}
                  maxLength={10}
                  autoFocus
                  className="veil-glass-input px-4 py-3.5 rounded-2xl text-[18px] text-white font-mono tracking-[0.4em] text-center placeholder:text-white/15 outline-none"
                />

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={{ opacity: 0, y: -4, height: 0 }}
                      className="flex items-start gap-2 text-red-300/90 text-[12px] px-1 overflow-hidden"
                    >
                      <AlertCircle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={!guardCode}
                  className="veil-btn-primary mt-2 py-3 rounded-2xl text-[13.5px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Verify
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {phase === 'awaiting-device' && (
          <motion.div
            key="device"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={SPRING}
            className="relative flex-1 flex items-center justify-center"
          >
            <div className="veil-glass rounded-[28px] p-10 w-full max-w-[420px] flex flex-col items-center text-center">
              <div className="relative w-20 h-20 mb-5">
                <div
                  className="absolute inset-0 rounded-3xl veil-pulse"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)',
                    filter: 'blur(14px)',
                  }}
                />
                <div
                  className="relative w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 32px -8px rgba(0,0,0,0.5)',
                  }}
                >
                  <Smartphone size={26} strokeWidth={1.5} className="text-white" />
                </div>
              </div>
              <p className="text-white font-semibold text-[17px] tracking-[-0.02em]">
                Confirm on your phone
              </p>
              <p className="text-white/40 text-[12px] mt-1.5 max-w-[280px]">
                Open the Steam Mobile app and approve this sign-in attempt
              </p>
              <div className="flex items-center gap-2 mt-6 text-white/30 text-[11.5px]">
                <Loader2 size={13} className="animate-spin" />
                Waiting for confirmation
              </div>
            </div>
          </motion.div>
        )}

        {phase === 'logged-in' && (
          <motion.div
            key="library"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="relative flex-1 flex flex-col min-h-0 min-w-0"
          >
            <div className="flex items-center gap-3 mb-5 min-w-0">
              <div className="veil-glass rounded-2xl pl-2 pr-4 py-2 flex items-center gap-3 min-w-0 max-w-[240px] shrink-0">
                <div
                  className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0 bg-white/[0.06]"
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
                  }}
                >
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.persona_name || 'Steam'}
                      className="w-full h-full object-cover"
                      draggable={false}
                      onError={() =>
                        setProfile((p) => (p ? { ...p, avatar_url: null } : p))
                      }
                    />
                  ) : (
                    <User size={15} strokeWidth={1.5} className="text-white/50" />
                  )}
                </div>
                <div className="min-w-0 pr-1 flex-1">
                  <p
                    className="text-white font-semibold text-[12.5px] leading-tight truncate"
                    title={profile?.persona_name || username || 'Steam user'}
                  >
                    {profile?.persona_name || username || 'Steam user'}
                  </p>
                  <p className="text-white/35 text-[10.5px] font-medium truncate leading-tight mt-0.5">
                    Signed in
                  </p>
                </div>
              </div>

              <div className="veil-glass-input rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-1 min-w-0">
                <Search size={14} strokeWidth={1.5} className="text-white/35 shrink-0" />
                <input
                  type="text"
                  placeholder={`Search ${games.length} games`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none min-w-0 w-full"
                />
                {gamesLoading && (
                  <Loader2 size={13} className="animate-spin text-white/40 shrink-0" />
                )}
              </div>

              <button
                onClick={handleLogout}
                className="veil-btn flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[12px] text-white/70 font-medium shrink-0"
              >
                <LogOut size={13} strokeWidth={1.5} />
                Sign out
              </button>
            </div>

            <div className="min-w-0">
              <AnimatePresence initial={false}>
                {lastDump && (
                  <motion.div
                    key="toast-success"
                    initial={{ opacity: 0, y: -16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -16, scale: 0.96 }}
                    transition={{
                      type: 'spring',
                      stiffness: 320,
                      damping: 30,
                      mass: 0.8,
                    }}
                    className="veil-glass rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 min-w-0"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background:
                          'linear-gradient(155deg, rgba(255,255,255,0.14), rgba(255,255,255,0.02))',
                        border: '1px solid rgba(255,255,255,0.16)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
                      }}
                    >
                      <CheckCircle size={16} strokeWidth={1.8} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-[13px] tracking-[-0.01em] truncate">
                        {lastDump.app_name} dumped
                      </p>
                      <p className="text-white/40 text-[11px] mt-0.5 truncate font-medium">
                        {lastDump.depots_dumped} depot
                        {lastDump.depots_dumped === 1 ? '' : 's'} · folder opened
                      </p>
                    </div>
                    <button
                      onClick={() => setLastDump(null)}
                      aria-label="Dismiss"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-all shrink-0"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    key="toast-error"
                    initial={{ opacity: 0, y: -16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -16, scale: 0.96 }}
                    transition={{
                      type: 'spring',
                      stiffness: 320,
                      damping: 30,
                      mass: 0.8,
                    }}
                    className="veil-glass rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 min-w-0"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      <AlertCircle size={16} strokeWidth={1.8} className="text-white/85" />
                    </div>
                    <p className="flex-1 text-white/75 text-[12.5px] min-w-0 truncate">
                      {error}
                    </p>
                    <button
                      onClick={() => setError('')}
                      aria-label="Dismiss"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-all shrink-0"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div
              className="relative flex-1 min-h-0 min-w-0"
              style={{
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
                maskImage:
                  'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
              }}
            >
              <div className="absolute inset-0 overflow-y-auto overflow-x-hidden pr-2 pt-3 pb-3">
              {filteredGames.length === 0 && !gamesLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-white/25 gap-3">
                  <Package size={36} strokeWidth={1} />
                  <p className="text-[13px]">
                    {games.length === 0
                      ? 'No games in this library'
                      : 'No games match your search'}
                  </p>
                </div>
              )}

              <motion.div
                layout
                className="grid grid-cols-2 xl:grid-cols-3 gap-3 pb-2"
              >
                <AnimatePresence>
                  {filteredGames.map((game, idx) => {
                    const isDumping = dumpingId === game.app_id
                    const disabled = dumpingId !== null && !isDumping
                    return (
                      <motion.div
                        key={game.app_id}
                        layout
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{
                          duration: 0.4,
                          ease: EASE,
                          delay: Math.min(idx * 0.018, 0.4),
                        }}
                        className={`veil-game-card rounded-2xl ${
                          isDumping ? 'is-dumping' : ''
                        }`}
                      >
                        <GameArt appId={game.app_id} name={game.name} />
                        <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-white font-semibold text-[12.5px] tracking-[-0.01em] truncate"
                              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
                            >
                              {game.name}
                            </p>
                            <p className="text-white/55 text-[10.5px] font-mono mt-0.5">
                              {game.app_id}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDump(game)}
                            disabled={disabled || isDumping}
                            className="veil-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                            style={{ backdropFilter: 'blur(20px)' }}
                          >
                            {isDumping ? (
                              <>
                                <Loader2 size={11} className="animate-spin" />
                                Dumping
                              </>
                            ) : (
                              <>
                                <Download size={11} strokeWidth={2} />
                                Dump
                              </>
                            )}
                          </button>
                        </div>

                        {isDumping && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background:
                                'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), transparent 70%)',
                            }}
                          />
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default DumperPage
