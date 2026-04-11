import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  Check,
  CloudOff,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return fallback
}

type PatchState =
  | 'not_installed'
  | 'unpatched'
  | 'patched'
  | 'partially_patched'
  | 'out_of_date'
  | 'payload_corrupt'
  | 'unknown_version'

interface Diagnostics {
  steam_path: string
  core_dll_name: string | null
  core_dll_state: PatchState
  capcom_state: PatchState
  offline_state: PatchState
  needs_dll_repair: boolean
  fingerprint: string
  cache_found: boolean
}

interface PatchActionResult {
  succeeded: boolean
  dll_patched: boolean
  cache_patched: boolean
  message: string
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

const STATE_META: Record<
  PatchState,
  { label: string; tone: string; desc: string }
> = {
  patched: {
    label: 'Applied',
    tone: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    desc: 'Fix is active',
  },
  unpatched: {
    label: 'Not Applied',
    tone: 'text-white/60 bg-white/[0.04] border-white/10',
    desc: 'Ready to apply',
  },
  partially_patched: {
    label: 'Partial',
    tone: 'text-amber-300 bg-amber-400/10 border-amber-400/20',
    desc: 'Some sites patched, some not — re-apply to finish',
  },
  out_of_date: {
    label: 'Out of Date',
    tone: 'text-rose-300 bg-rose-400/10 border-rose-400/20',
    desc: 'SteamTools version changed — signatures no longer match',
  },
  payload_corrupt: {
    label: 'Corrupt Cache',
    tone: 'text-rose-300 bg-rose-400/10 border-rose-400/20',
    desc: 'Payload cache could not be decrypted',
  },
  unknown_version: {
    label: 'Unknown Version',
    tone: 'text-amber-300 bg-amber-400/10 border-amber-400/20',
    desc: 'Patch sites not found in this SteamTools build',
  },
  not_installed: {
    label: 'Not Installed',
    tone: 'text-white/40 bg-white/[0.03] border-white/8',
    desc: 'SteamTools cache not found yet',
  },
}

type FixId = 'capcom' | 'offline'

interface FixMeta {
  id: FixId
  icon: typeof CloudOff
  title: string
  blurb: string
  detail: string
  command: string
}

const FIXES: FixMeta[] = [
  {
    id: 'capcom',
    icon: CloudOff,
    title: 'Capcom Save Fix',
    blurb: 'Stops SteamTools from rewriting Steam Cloud App IDs.',
    detail:
      'Patches 3 sites in the SteamTools payload cache that used to swap Cloud request App IDs with Spacewar\u2019s (480). Valve broke that behavior in 2024; a side effect is Capcom titles (Monster Hunter, RE, DMC) refusing to create saves. This patch leaves Cloud requests alone so saves work again.',
    command: 'patcher_apply_capcom',
  },
  {
    id: 'offline',
    icon: Zap,
    title: 'Offline Setup',
    blurb: 'Makes SteamTools complete first-run setup without its server.',
    detail:
      'Patches 2 sites in the Core DLL (xinput1_4.dll / dwmapi.dll) and 2 sites in the payload cache so the activation handshake always succeeds \u2014 no network request, no GetCookie retry loop. Use this if SteamTools is stuck on first-run or its server is down.',
    command: 'patcher_apply_offline',
  },
]

function PatcherPage() {
  const [steamPath, setSteamPath] = useState<string>('')
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<FixId | 'restore' | null>(null)
  const [toast, setToast] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 5000)
    },
    [],
  )

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const refreshDiag = useCallback(async (path: string) => {
    if (!path) return
    try {
      const d = await invoke<Diagnostics>('patcher_diagnose', {
        steamPath: path,
      })
      setDiag(d)
    } catch (e) {
      console.error('patcher_diagnose failed', e)
      setDiag(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const cfg = await invoke<{ steam_path: string }>('get_app_config')
        if (cancelled) return
        const path = cfg.steam_path || ''
        setSteamPath(path)
        if (path) await refreshDiag(path)
      } catch (e) {
        console.error('boot patcher failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [refreshDiag])

  const runAction = useCallback(
    async (
      id: FixId | 'restore',
      command: string,
      successMessage: string,
      manageSteam: boolean,
    ) => {
      if (!steamPath) {
        showToast('error', 'Steam path not configured')
        return
      }
      setBusy(id)
      let steamWasRunning = false
      const isApply = id === 'capcom' || id === 'offline'
      if (isApply) {
        try {
          const cfg = await invoke<{ steam_path: string; veil_enabled: boolean; patches_applied: boolean }>('get_app_config')
          await invoke('save_app_config', { config: { ...cfg, patches_applied: true } })
        } catch (e) {
          console.error('failed to set patches_applied flag', e)
        }
      }
      try {
        if (manageSteam) {
          steamWasRunning = await invoke<boolean>('shutdown_steam_for_patching')
        }

        const res = await invoke<PatchActionResult>(command, { steamPath })

        if (manageSteam && steamWasRunning) {
          try {
            await invoke('start_steam')
          } catch (e) {
            console.error('start_steam after patch failed', e)
          }
          showToast(
            'success',
            `${res.message || successMessage} \u2014 Steam restarted`,
          )
        } else {
          showToast('success', res.message || successMessage)
        }
        await refreshDiag(steamPath)
      } catch (e) {
        console.error(command, e)
        showToast('error', errorMessage(e, 'Operation failed'))
        if (isApply) {
          try {
            const cfg = await invoke<{ steam_path: string; veil_enabled: boolean; patches_applied: boolean }>('get_app_config')
            await invoke('save_app_config', { config: { ...cfg, patches_applied: false } })
          } catch {}
        }
        if (manageSteam && steamWasRunning) {
          try {
            await invoke('start_steam')
          } catch {}
        }
      } finally {
        setBusy(null)
      }
    },
    [steamPath, showToast, refreshDiag],
  )

  const getState = (id: FixId): PatchState => {
    if (!diag) return 'not_installed'
    return id === 'capcom' ? diag.capcom_state : diag.offline_state
  }

  const applyLabel = (state: PatchState): string => {
    if (state === 'patched') return 'Re-apply'
    if (state === 'partially_patched') return 'Finish'
    return 'Apply Fix'
  }

  const applyDisabled = (state: PatchState): boolean => {
    return (
      state === 'not_installed' ||
      state === 'payload_corrupt' ||
      state === 'unknown_version' ||
      state === 'out_of_date'
    )
  }

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-5 shrink-0"
      >
        <h1 className="text-white font-bold tracking-[-0.03em] text-[22px]">
          Patcher
        </h1>
        <p className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-white/30">
          Surgical binary patches for the SteamTools loader and its payload cache
        </p>
      </motion.div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-white/40" size={20} />
          </div>
        ) : !diag ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="veil-icon-box w-11 h-11 rounded-xl flex items-center justify-center">
              <AlertTriangle size={18} className="text-amber-400" strokeWidth={1.5} />
            </div>
            <p className="text-white/70 text-[13px] font-medium">
              Couldn&rsquo;t read diagnostic state
            </p>
            <p className="text-white/30 text-[11px] max-w-sm">
              Make sure the Steam path is configured in Settings, then come back.
            </p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE, delay: 0.05 }}
            className="flex flex-col gap-4"
          >
            <div
              className="veil-card rounded-2xl px-5 py-4"
              style={{ backdropFilter: 'blur(24px)' }}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30 font-semibold">
                    SteamTools Environment
                  </p>
                  <p
                    className="text-white/80 text-[12.5px] font-medium mt-1.5 truncate"
                    title={diag.steam_path}
                  >
                    {diag.steam_path || 'Not set'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <MiniBadge
                    label="Core DLL"
                    value={
                      diag.core_dll_name
                        ? diag.core_dll_name
                        : diag.needs_dll_repair
                          ? 'Missing'
                          : 'Unknown'
                    }
                    ok={!!diag.core_dll_name}
                  />
                  <MiniBadge
                    label="Payload"
                    value={diag.cache_found ? 'Found' : 'Not found'}
                    ok={diag.cache_found}
                  />
                  <MiniBadge
                    label="Fingerprint"
                    value={diag.fingerprint.slice(0, 8)}
                    mono
                    ok
                  />
                </div>
              </div>
            </div>

            {FIXES.map((fix) => {
              const state = getState(fix.id)
              const meta = STATE_META[state]
              const Icon = fix.icon
              const isBusy = busy === fix.id

              return (
                <motion.div
                  key={fix.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="veil-card rounded-2xl p-5"
                  style={{ backdropFilter: 'blur(24px)' }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background:
                          'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <Icon size={18} strokeWidth={1.5} className="text-white/75" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-white font-semibold text-[14px] tracking-[-0.01em]">
                          {fix.title}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${meta.tone}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-white/55 text-[12px] mt-1 leading-relaxed">
                        {fix.blurb}
                      </p>
                      <p className="text-white/35 text-[11.5px] mt-2 leading-relaxed">
                        {fix.detail}
                      </p>
                      {state !== 'unpatched' && state !== 'patched' && (
                        <p className="text-white/40 text-[11px] mt-2 italic">
                          {meta.desc}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        runAction(
                          fix.id,
                          fix.command,
                          `${fix.title} applied`,
                          true,
                        )
                      }
                      disabled={isBusy || applyDisabled(state) || busy !== null}
                      className="veil-btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Patching
                        </>
                      ) : state === 'patched' ? (
                        <>
                          <Check size={12} strokeWidth={2.5} />
                          {applyLabel(state)}
                        </>
                      ) : (
                        <>
                          <Zap size={12} strokeWidth={2} />
                          {applyLabel(state)}
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )
            })}

            <div className="mt-2">
              <UtilityCard
                icon={RotateCcw}
                title="Restore Pristine DLLs"
                desc="Clears any applied patches, rewrites the bundled unpatched xinput1_4.dll / dwmapi.dll, and wipes the payload cache. SteamTools will redownload a fresh cache on next launch."
                busy={busy === 'restore'}
                disabled={busy !== null}
                onClick={() =>
                  runAction(
                    'restore',
                    'patcher_restore',
                    'Restore complete',
                    true,
                  )
                }
                buttonLabel="Restore"
                busyLabel="Restoring"
                highlight={diag.needs_dll_repair}
              />
            </div>

            <div className="flex items-start gap-3 px-1 mt-1">
              <ShieldCheck
                size={14}
                strokeWidth={1.5}
                className="text-white/30 shrink-0 mt-0.5"
              />
              <p className="text-white/30 text-[11px] leading-relaxed">
                Every patch dry-runs first and aborts on any byte mismatch
                before touching disk. If Steam is running when you click a
                fix, Veil shuts it down, applies the patch, and starts it
                back up for you. Restore rewrites the bundled pristine DLLs.
              </p>
            </div>
          </motion.div>
        )}
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
            <p className="text-white text-[12.5px] font-medium flex-1 min-w-0 break-words">
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

function MiniBadge({
  label,
  value,
  ok,
  mono,
}: {
  label: string
  value: string
  ok: boolean
  mono?: boolean
}) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <span className="text-[9.5px] uppercase tracking-wider text-white/35 font-semibold">
        {label}
      </span>
      <span
        className={`text-[11px] font-semibold ${
          mono ? 'font-mono' : ''
        } ${ok ? 'text-white/80' : 'text-amber-300/90'}`}
      >
        {value}
      </span>
    </div>
  )
}

function UtilityCard({
  icon: Icon,
  title,
  desc,
  busy,
  disabled,
  onClick,
  buttonLabel,
  busyLabel,
  highlight,
}: {
  icon: typeof Wrench
  title: string
  desc: string
  busy: boolean
  disabled: boolean
  onClick: () => void
  buttonLabel: string
  busyLabel: string
  highlight?: boolean
}) {
  return (
    <div
      className="veil-card rounded-2xl p-4 flex flex-col h-full"
      style={{
        backdropFilter: 'blur(24px)',
        borderColor: highlight ? 'rgba(251,191,36,0.35)' : undefined,
      }}
    >
      <div className="flex items-start gap-3 flex-1">
        <div className="veil-icon-box w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
          <Icon size={15} strokeWidth={1.5} className="text-white/70" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-semibold text-[13px] tracking-[-0.01em]">
            {title}
          </h4>
          <p className="text-white/40 text-[11px] mt-1 leading-relaxed">{desc}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={busy || disabled}
        className="veil-btn w-full mt-3 py-2 rounded-xl text-[12px] text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {busyLabel}
          </>
        ) : (
          buttonLabel
        )}
      </button>
    </div>
  )
}

export default PatcherPage
