import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  FolderOpen,
  ArrowsClockwise,
  ArrowCounterClockwise,
  CircleNotch,
  CheckCircle,
  DownloadSimple,
  Warning,
  X,
  ArrowSquareOut,
} from '@phosphor-icons/react'
import { useLibrary } from '../lib/library-context'
import { openUrl } from '../lib/library'
import { useInstaller } from '../lib/installer-context'
import { useMaximized } from '../lib/useMaximized'
import {
  getAppConfig,
  saveAppConfig,
  resolveDumpPath,
  ensureVeilDll,
  removeVeilDll,
  resetSteamInstall,
  downloadAndRunUpdate,
  type AppConfig,
  type ResetResult,
} from '../lib/config'
import { cloudSavesEnsure } from '../lib/cloudsave'

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-emerald-500/80' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200 ${
          on ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-600">{title}</p>
      {children}
    </div>
  )
}

function Row({
  label,
  desc,
  children,
}: {
  label: string
  desc: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-neutral-200">{label}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function PathRow({
  label,
  desc,
  path,
  onChange,
}: {
  label: string
  desc: React.ReactNode
  path: string
  onChange: () => void
}) {
  return (
    <div>
      <Row label={label} desc={desc}>
        <button
          onClick={onChange}
          className="flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[12px] font-semibold text-neutral-300 transition hover:bg-white/[0.05] active:scale-95"
        >
          <FolderOpen size={14} weight="bold" />
          Change
        </button>
      </Row>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
        <FolderOpen size={13} weight="fill" className="shrink-0 text-neutral-600" />
        <span className={`truncate font-mono text-[11px] ${path ? 'text-neutral-400' : 'text-neutral-600'}`}>
          {path || 'Not set'}
        </span>
      </div>
    </div>
  )
}

function ResetModal({
  onConfirm,
  onClose,
  phase,
  result,
}: {
  onConfirm: () => void
  onClose: () => void
  phase: 'confirm' | 'running' | 'done'
  result: ResetResult | null
}) {
  const maximized = useMaximized()
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      onMouseDown={phase === 'running' ? undefined : onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#161616] p-6 shadow-2xl shadow-black/60"
      >
        {phase !== 'running' && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-neutral-600 transition-colors hover:text-neutral-300"
          >
            <X size={16} weight="bold" />
          </button>
        )}
        {phase === 'running' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-neutral-400">
            <CircleNotch size={24} className="animate-spin" />
            <p className="text-[13px] font-medium">Resetting Steam…</p>
            <p className="text-[11.5px] text-neutral-600">Closing Steam and wiping core files.</p>
          </div>
        ) : phase === 'done' ? (
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle size={20} weight="fill" />
            </div>
            <h3 className="mt-4 text-[16px] font-bold text-neutral-100">Steam reset</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
              Removed {result?.deleted_entries ?? 0} item{result?.deleted_entries !== 1 ? 's' : ''}
              {result?.freed_bytes ? ` · freed ${(result.freed_bytes / 1e9).toFixed(2)} GB` : ''}.
              {result?.steam_started ? ' Steam is restarting and will re-download its core files.' : ''}
            </p>
            {result && result.failed_entries > 0 && (
              <p className="mt-2 text-[12px] text-amber-300/90">
                {result.failed_entries} item{result.failed_entries !== 1 ? 's' : ''} couldn't be removed (in use).
              </p>
            )}
            <div className="mt-6 flex">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg bg-neutral-100 py-2.5 text-[13px] font-semibold text-neutral-900 transition-colors hover:bg-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-400">
              <Warning size={20} weight="bold" />
            </div>
            <h3 className="mt-4 text-[16px] font-bold text-neutral-100">Reset Steam?</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
              This closes Steam and wipes its core files to force a fresh download. Your{' '}
              <span className="text-neutral-300">games, saves, logins, and Veil manifests are kept</span>.
              Steam relaunches and repairs itself automatically.
            </p>
            <div className="mt-6 flex gap-2.5">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2.5 text-[13px] font-semibold text-neutral-300 transition-colors hover:bg-white/[0.07] hover:text-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-400"
              >
                Reset Steam
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

export default function SettingsPage() {
  const { steamPath, setSteamPath } = useLibrary()
  const { updateInfo, refreshUpdate, notify } = useInstaller()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [veilBusy, setVeilBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [resetPhase, setResetPhase] = useState<'idle' | 'confirm' | 'running' | 'done'>('idle')
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [defaultDumpPath, setDefaultDumpPath] = useState('')

  useEffect(() => {
    getAppConfig().then(setConfig).catch(() => {})
    resolveDumpPath().then(setDefaultDumpPath).catch(() => {})
  }, [])

  const persist = useCallback(async (next: AppConfig) => {
    setConfig(next)
    await saveAppConfig(next).catch(() => {})
  }, [])

  const toggleVeil = useCallback(async () => {
    if (!config || veilBusy) return
    const next = { ...config, veil_enabled: !config.veil_enabled }
    await persist(next)
    if (!config.steam_path) return
    setVeilBusy(true)
    try {
      if (next.veil_enabled) {
        await ensureVeilDll(config.steam_path)
        notify('success', 'Veil enabled')
      } else {
        await removeVeilDll(config.steam_path)
        notify('success', 'Veil disabled')
      }
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setVeilBusy(false)
    }
  }, [config, veilBusy, persist, notify])

  const changePath = useCallback(async () => {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: config?.steam_path || undefined,
    })
    if (typeof dir !== 'string' || !config) return
    await persist({ ...config, steam_path: dir })
    await setSteamPath(dir)
    notify('success', 'Steam path updated')
  }, [config, persist, setSteamPath, notify])

  const changeDumpPath = useCallback(async () => {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: defaultDumpPath || undefined,
    })
    if (typeof dir !== 'string' || !config) return
    await persist({ ...config, dump_path: dir })
    setDefaultDumpPath(dir)
    notify('success', 'Game dump location updated')
  }, [config, defaultDumpPath, persist, notify])

  const checkNow = useCallback(async () => {
    setChecking(true)
    await refreshUpdate()
    setChecking(false)
  }, [refreshUpdate])

  const installUpdate = useCallback(async () => {
    if (!updateInfo?.download_url || updating) return
    setUpdating(true)
    try {
      await downloadAndRunUpdate(updateInfo.download_url)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
      setUpdating(false)
    }
  }, [updateInfo, updating, notify])

  const runReset = useCallback(async () => {
    if (!config?.steam_path) return
    setResetPhase('running')
    try {
      const r = await resetSteamInstall(config.steam_path)
      await invoke('kill_steam').catch(() => {})
      if (config.veil_enabled) await ensureVeilDll(config.steam_path).catch(() => {})
      await cloudSavesEnsure(config.steam_path).catch(() => {})
      await invoke('start_steam').catch(() => {})
      setResetResult(r)
      setResetPhase('done')
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
      setResetPhase('idle')
    }
  }, [config, notify])

  const path = config?.steam_path || steamPath || ''
  const dumpPath = defaultDumpPath

  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <div className="mx-auto flex max-w-[640px] flex-col gap-6">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-neutral-100">Settings</h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            Manage Veil, your Steam installation, and where dumps are saved.
          </p>
        </div>

        <Section title="Veil">
          <Row
            label="Enable Veil"
            desc={veilBusy ? 'Applying…' : 'Enables the loading of custom manifests via Veil.'}
          >
            {veilBusy ? (
              <CircleNotch size={18} className="animate-spin text-neutral-500" />
            ) : (
              <Toggle on={!!config?.veil_enabled} onClick={toggleVeil} disabled={!config} />
            )}
          </Row>
        </Section>

        <Section title="Locations">
          <PathRow
            label="Steam path"
            desc="Where your Steam installation lives. Auto-detected on first run."
            path={path}
            onChange={changePath}
          />
          {!path && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-amber-300/90">
              <Warning size={13} weight="bold" /> Steam installation not detected — set the path above.
            </p>
          )}
          <div className="my-4 border-t border-white/[0.05]" />
          <PathRow
            label="Game dump location"
            desc="Where dumped game manifests are saved. Each game gets its own folder inside."
            path={dumpPath}
            onChange={changeDumpPath}
          />
        </Section>

        <Section title="Updates">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-neutral-200">
                  {updateInfo?.available ? 'Update available' : 'Veil is up to date'}
                </p>
                {updateInfo?.available && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    New
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] text-neutral-500">
                Current <span className="font-mono text-neutral-400">{updateInfo?.current_version || '—'}</span>
                {updateInfo?.latest_version &&
                  updateInfo.latest_version !== updateInfo.current_version && (
                    <>
                      {' · '}Latest <span className="font-mono text-neutral-400">{updateInfo.latest_version}</span>
                    </>
                  )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={checkNow}
                disabled={checking || updating}
                className="flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[12px] font-semibold text-neutral-300 transition hover:bg-white/[0.05] active:scale-95 disabled:opacity-50"
              >
                <ArrowsClockwise size={13} weight="bold" className={checking ? 'animate-spin' : ''} />
                Check
              </button>
              {updateInfo?.available && (
                <button
                  onClick={installUpdate}
                  disabled={updating}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-neutral-100 px-3.5 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-60"
                >
                  {updating ? (
                    <CircleNotch size={14} weight="bold" className="animate-spin" />
                  ) : (
                    <DownloadSimple size={14} weight="bold" />
                  )}
                  {updating ? 'Updating…' : 'Update now'}
                </button>
              )}
            </div>
          </div>
          {updateInfo?.available && updateInfo.release_notes && (
            <div className="mt-4 border-t border-white/[0.05] pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-600">Release notes</p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-neutral-500">
                {updateInfo.release_notes}
              </pre>
            </div>
          )}
        </Section>

        <Section title="Maintenance">
          <Row
            label="Reset Steam"
            desc="Wipe Steam's core files for a fresh download. Games, saves, logins, and manifests are kept."
          >
            <button
              onClick={() => setResetPhase('confirm')}
              disabled={!path}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-red-500/10 px-3.5 text-[12px] font-semibold text-red-300 transition hover:bg-red-500/20 active:scale-95 disabled:opacity-40"
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              Reset
            </button>
          </Row>
        </Section>

        <button
          onClick={() => openUrl('https://discord.gg/veilapp').catch(() => {})}
          className="group mt-1 flex items-center gap-4 rounded-xl border border-white/[0.14] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/[0.22] hover:bg-white/[0.04] active:scale-[0.995]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
            <span
              className="h-[18px] w-[18px] bg-neutral-300 transition-colors group-hover:bg-white"
              style={{
                WebkitMaskImage: 'url(/icons/discord.svg)',
                maskImage: 'url(/icons/discord.svg)',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-neutral-200">Join the Community · Official Veil Server</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">
              Generate manifests for any game · Fast &amp; reliable support
            </p>
          </div>
          <ArrowSquareOut
            size={16}
            weight="bold"
            className="shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-400"
          />
        </button>
      </div>

      {resetPhase !== 'idle' && (
        <ResetModal
          phase={resetPhase}
          result={resetResult}
          onConfirm={runReset}
          onClose={() => setResetPhase('idle')}
        />
      )}
    </div>
  )
}
