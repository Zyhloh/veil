import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { listen } from '@tauri-apps/api/event'
import {
  CircleNotch,
  DownloadSimple,
  SignOut,
  DeviceMobile,
  MagnifyingGlass,
  X,
  ArrowRight,
} from '@phosphor-icons/react'
import { useInstaller } from '../lib/installer-context'
import { useInView, useReleasedDlc } from '../lib/dlc'
import SteamArt from '../components/SteamArt'
import ScrollFade from '../components/ScrollFade'
import {
  dumperLogin,
  dumperSubmitGuard,
  dumperStatus,
  dumperLogout,
  dumperOwnedGames,
  dumperDumpApp,
  dumperGetProfile,
  type OwnedGame,
  type SteamProfile,
} from '../lib/dumper'

const TOKEN_KEY = 'veil.dumper.refresh_token'
const EMPTY: number[] = []

type Phase = 'logged-out' | 'logging-in' | 'awaiting-code' | 'awaiting-device' | 'logged-in'

function DumperGameRow({
  game,
  dumping,
  anyDumping,
  index,
  onDump,
}: {
  game: OwnedGame
  dumping: boolean
  anyDumping: boolean
  index: number
  onDump: () => void
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const { dlcIds, loading } = useReleasedDlc(game.app_id, EMPTY, inView)
  const hours = Math.round(game.playtime / 60)

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.2) }}
      className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
    >
      <SteamArt appId={game.app_id} className="h-[58px] w-[124px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-neutral-100">{game.name}</p>
        <p className="mt-1 text-[11px] font-medium text-neutral-600">
          App ID {game.app_id}
          {hours > 0 ? ` · ${hours.toLocaleString()}h played` : ''}
        </p>
      </div>

      {inView && (loading ? (
        <CircleNotch size={13} className="shrink-0 animate-spin text-neutral-600" />
      ) : dlcIds.length > 0 ? (
        <span className="shrink-0 rounded-md border border-white/[0.06] px-2 py-1 text-[11px] font-semibold text-neutral-400">
          {dlcIds.length} DLC
        </span>
      ) : null)}

      <button
        onClick={onDump}
        disabled={anyDumping}
        className="flex h-9 w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-neutral-100 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-neutral-600"
      >
        {dumping ? (
          <CircleNotch size={15} weight="bold" className="animate-spin" />
        ) : (
          <>
            <DownloadSimple size={15} weight="bold" />
            Dump
          </>
        )}
      </button>
    </motion.div>
  )
}

export default function DumperPage() {
  const { notify } = useInstaller()
  const [phase, setPhase] = useState<Phase>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY) ? 'logging-in' : 'logged-out',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [guardIsEmail, setGuardIsEmail] = useState(false)
  const [submittingCode, setSubmittingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profile, setProfile] = useState<SteamProfile | null>(null)
  const [games, setGames] = useState<OwnedGame[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [dumpingId, setDumpingId] = useState<number | null>(null)

  const startedRef = useRef(false)

  const refreshGames = useCallback(async () => {
    setGamesLoading(true)
    try {
      const res = await dumperOwnedGames()
      const sorted = [...res.games].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
      setGames(sorted)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGamesLoading(false)
    }
  }, [])

  const afterLogin = useCallback(async () => {
    const status = await dumperStatus().catch(() => null)
    if (status?.steam_id) {
      dumperGetProfile(status.steam_id)
        .then(setProfile)
        .catch(() => {})
    }
    setPhase('logged-in')
    setError(null)
    await refreshGames()
  }, [refreshGames])

  const beginLogin = useCallback(
    async (args: { username?: string; password?: string; refreshToken?: string }) => {
      setError(null)
      setPhase('logging-in')
      try {
        const result = await dumperLogin(args)
        if (result.refresh_token) {
          try {
            localStorage.setItem(TOKEN_KEY, result.refresh_token)
          } catch {
          }
        }
        await afterLogin()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (args.refreshToken) {
          try {
            localStorage.removeItem(TOKEN_KEY)
          } catch {
          }
          setPhase('logged-out')
        } else {
          setError(msg)
          setPhase('logged-out')
        }
      }
    },
    [afterLogin],
  )

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const saved = (() => {
      try {
        return localStorage.getItem(TOKEN_KEY)
      } catch {
        return null
      }
    })()
    if (saved) Promise.resolve().then(() => beginLogin({ refreshToken: saved }))
  }, [beginLogin])

  useEffect(() => {
    const unlisten = [
      listen<{ is_email?: boolean }>('dumper:needs_steam_guard', (e) => {
        setGuardIsEmail(!!e.payload?.is_email)
        setCode('')
        setPhase('awaiting-code')
      }),
      listen('dumper:needs_device_confirmation', () => setPhase('awaiting-device')),
      listen('dumper:terminated', () => {
        setPhase('logged-out')
        setError('Steam session ended unexpectedly.')
      }),
    ]
    return () => {
      unlisten.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const submitGuard = useCallback(async () => {
    if (!code.trim() || submittingCode) return
    setSubmittingCode(true)
    setError(null)
    try {
      await dumperSubmitGuard(code.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmittingCode(false)
    }
  }, [code, submittingCode])

  const logout = useCallback(async () => {
    await dumperLogout().catch(() => {})
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
    }
    setPhase('logged-out')
    setProfile(null)
    setGames([])
    setUsername('')
    setPassword('')
  }, [])

  const dump = useCallback(
    async (game: OwnedGame) => {
      if (dumpingId) return
      setDumpingId(game.app_id)
      try {
        const res = await dumperDumpApp(game.app_id)
        notify(
          'success',
          `${res.app_name} dumped — ${res.depots_dumped} depot${res.depots_dumped !== 1 ? 's' : ''}, folder opened`,
        )
      } catch (e) {
        notify('error', e instanceof Error ? e.message : String(e))
      } finally {
        setDumpingId(null)
      }
    },
    [dumpingId, notify],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return games
    return games.filter((g) => g.name.toLowerCase().includes(q) || String(g.app_id).includes(q))
  }, [games, query])

  if (phase !== 'logged-in') {
    return (
      <div className="flex h-full items-center justify-center px-10 py-8">
        <div className="w-full max-w-[360px]">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
              <img src="/icons/steam.png" alt="Steam" className="h-7 w-7 object-contain" />
            </div>
            <h2 className="text-lg font-bold text-neutral-100">Sign in to Steam</h2>
            <p className="mt-1 text-[12.5px] text-neutral-500">
              Dump manifests and depot keys for the games you own.
            </p>
          </div>

          {phase === 'logging-in' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-neutral-500">
              <CircleNotch size={22} className="animate-spin" />
              <p className="text-[13px] font-medium">Signing in…</p>
            </div>
          ) : phase === 'awaiting-device' ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-7 text-center">
              <DeviceMobile size={28} className="text-neutral-300" />
              <p className="text-[13px] font-semibold text-neutral-200">Approve in the Steam Mobile app</p>
              <p className="text-[12px] text-neutral-500">Waiting for confirmation…</p>
              <CircleNotch size={18} className="animate-spin text-neutral-600" />
            </div>
          ) : phase === 'awaiting-code' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[12.5px] text-neutral-400">
                {guardIsEmail
                  ? 'Enter the Steam Guard code sent to your email.'
                  : 'Enter the code from your Steam Mobile authenticator.'}
              </p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && submitGuard()}
                maxLength={10}
                autoFocus
                placeholder="XXXXX"
                className="h-11 w-full select-text rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 text-center text-[15px] font-bold tracking-[0.3em] text-neutral-100 outline-none transition-colors placeholder:tracking-normal placeholder:text-neutral-700 focus:border-white/[0.16]"
              />
              {error && <p className="text-[12px] font-medium text-red-400">{error}</p>}
              <button
                onClick={submitGuard}
                disabled={!code.trim() || submittingCode}
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-100 text-[13px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-50"
              >
                {submittingCode ? <CircleNotch size={15} weight="bold" className="animate-spin" /> : 'Continue'}
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (username && password) beginLogin({ username, password })
              }}
              className="flex flex-col gap-2.5"
            >
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Steam username"
                autoComplete="off"
                className="h-11 w-full select-text rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 text-[13px] text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/[0.16]"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Password"
                className="h-11 w-full select-text rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 text-[13px] text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/[0.16]"
              />
              {error && <p className="text-[12px] font-medium text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={!username || !password}
                className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-100 text-[13px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-50"
              >
                Sign in
                <ArrowRight size={15} weight="bold" />
              </button>
              <p className="mt-1 text-center text-[10.5px] leading-relaxed text-neutral-600">
                Your credentials go straight to Steam and are never stored — only Steam's session token is kept locally.
              </p>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04]">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <img src="/icons/steam.png" alt="Steam" className="h-5 w-5 object-contain" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-neutral-100">
            {profile?.persona_name || 'Steam user'}
          </p>
          <p className="text-[11px] font-medium text-neutral-600">
            {games.length} game{games.length !== 1 ? 's' : ''} owned
          </p>
        </div>
        <button
          onClick={logout}
          className="flex h-9 items-center gap-1.5 rounded-md border border-white/[0.06] px-3 text-[12px] font-semibold text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200 active:scale-95"
        >
          <SignOut size={14} weight="bold" />
          Sign out
        </button>
      </div>

      <div className="relative mb-4 shrink-0">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your games…"
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

      {gamesLoading && games.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <CircleNotch size={22} className="animate-spin" />
          <p className="text-[13px] font-medium">Loading your library…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <MagnifyingGlass size={24} />
          <p className="text-[13px] font-medium">No games found</p>
        </div>
      ) : (
        <ScrollFade className="flex-1 pr-1" contentClassName="space-y-2.5">
          {filtered.map((game, i) => (
            <DumperGameRow
              key={game.app_id}
              game={game}
              index={i}
              dumping={dumpingId === game.app_id}
              anyDumping={dumpingId !== null}
              onDump={() => dump(game)}
            />
          ))}
        </ScrollFade>
      )}
    </div>
  )
}
