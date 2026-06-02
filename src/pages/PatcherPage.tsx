import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  CloudSlash,
  Lightning,
  ArrowCounterClockwise,
  CircleNotch,
  ArrowLeft,
  Cube,
  Files,
  Fingerprint,
} from '@phosphor-icons/react'
import { useLibrary } from '../lib/library-context'
import { useInstaller } from '../lib/installer-context'
import {
  patcherDiagnose,
  patcherApplyCapcom,
  patcherApplyOffline,
  patcherRestore,
  type PatchState,
  type PatcherDiagnostics,
  type PatchActionResult,
} from '../lib/patcher'
import ScrollFade from '../components/ScrollFade'

const STATE_META: Record<PatchState, { label: string; cls: string }> = {
  not_installed: { label: 'Not found', cls: 'text-neutral-500 border-white/[0.1] bg-white/[0.03]' },
  unpatched: { label: 'Ready', cls: 'text-neutral-300 border-white/[0.12] bg-white/[0.05]' },
  patched: { label: 'Applied', cls: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10' },
  partially_patched: { label: 'Partial', cls: 'text-amber-300 border-amber-400/20 bg-amber-400/10' },
  out_of_date: { label: 'Out of date', cls: 'text-amber-300 border-amber-400/20 bg-amber-400/10' },
  payload_corrupt: { label: 'Unreadable', cls: 'text-red-300 border-red-500/20 bg-red-500/10' },
  unknown_version: { label: 'Unsupported', cls: 'text-red-300 border-red-500/20 bg-red-500/10' },
}

const BLOCKED: PatchState[] = ['not_installed', 'payload_corrupt', 'unknown_version', 'out_of_date']

function buttonLabel(state: PatchState): string {
  if (state === 'patched') return 'Re-apply'
  if (state === 'partially_patched') return 'Finish'
  return 'Apply'
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-5 py-3.5">
      <span className="text-neutral-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600">{label}</p>
        <p className="mt-0.5 truncate text-[12.5px] font-semibold text-neutral-200">{value}</p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-600">{title}</p>
      {children}
    </div>
  )
}

function FixRow({
  icon,
  title,
  blurb,
  state,
  busy,
  disabled,
  outline,
  actionLabel,
  onApply,
}: {
  icon: React.ReactNode
  title: string
  blurb: string
  state?: PatchState
  busy: boolean
  disabled: boolean
  outline?: boolean
  actionLabel?: string
  onApply: () => void
}) {
  const meta = state ? STATE_META[state] : null
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-neutral-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <p className="text-[14px] font-bold text-neutral-100">{title}</p>
          {meta && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}>
              {meta.label}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{blurb}</p>
      </div>
      <button
        onClick={onApply}
        disabled={disabled}
        className={
          outline
            ? 'flex h-9 w-[104px] shrink-0 items-center justify-center gap-2 rounded-lg border border-white/[0.1] text-[12.5px] font-semibold text-neutral-200 transition hover:bg-white/[0.05] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50'
            : 'flex h-9 w-[104px] shrink-0 items-center justify-center gap-2 rounded-lg bg-neutral-100 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-neutral-600'
        }
      >
        {busy ? (
          <CircleNotch size={15} weight="bold" className="animate-spin" />
        ) : (
          actionLabel ?? buttonLabel(state ?? 'unpatched')
        )}
      </button>
    </div>
  )
}

export default function PatcherPage({ onBack }: { onBack: () => void }) {
  const { steamPath } = useLibrary()
  const { notify } = useInstaller()
  const [diag, setDiag] = useState<PatcherDiagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const d = steamPath ? await patcherDiagnose(steamPath).catch(() => null) : null
    setDiag(d)
    setLoading(false)
  }, [steamPath])

  useEffect(() => {
    let alive = true
    const probe = steamPath ? patcherDiagnose(steamPath).catch(() => null) : Promise.resolve(null)
    probe.then((d) => {
      if (!alive) return
      setDiag(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [steamPath])

  const run = useCallback(
    async (id: string, label: string, action: () => Promise<PatchActionResult>) => {
      if (!steamPath || busy) return
      setBusy(id)
      const running = await invoke<boolean>('check_steam_running').catch(() => false)
      if (running) {
        await invoke('kill_steam').catch(() => {})
      }
      try {
        const res = await action()
        notify('success', `${label} — ${res.message}${running ? ' Steam restarted.' : ''}`)
      } catch (e) {
        notify('error', e instanceof Error ? e.message : String(e))
      } finally {
        if (running) await invoke('start_steam').catch(() => {})
        await refresh()
        setBusy(null)
      }
    },
    [steamPath, busy, notify, refresh],
  )

  const header = (
    <div className="mb-5 shrink-0">
      <button
        onClick={onBack}
        className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-neutral-500 transition-colors hover:text-neutral-300"
      >
        <ArrowLeft size={14} weight="bold" />
        Fixes
      </button>
      <h2 className="text-2xl font-bold text-neutral-100">SteamTools DLL Patches</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Fixes for the SteamTools core DLL and its payload cache. Steam is closed and reopened automatically.
      </p>
    </div>
  )

  return (
    <div className="flex h-full flex-col px-10 py-8">
      {header}

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
          <CircleNotch size={22} className="animate-spin" />
          <p className="text-[13px] font-medium">Inspecting SteamTools…</p>
        </div>
      ) : !steamPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-600">
          <p className="text-[13px] font-medium text-neutral-400">Steam installation not found</p>
          <p className="text-[12px]">Set your Steam path in Settings.</p>
        </div>
      ) : !diag ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-600">
          <p className="text-[13px] font-medium text-neutral-400">Couldn't inspect SteamTools</p>
          <button
            onClick={refresh}
            className="mt-1 rounded-md border border-white/[0.08] px-3 py-1.5 text-[12px] font-semibold text-neutral-300 transition hover:bg-white/[0.04]"
          >
            Retry
          </button>
        </div>
      ) : (
        <ScrollFade className="flex-1 pr-1" contentClassName="space-y-3 py-0.5">
          <div className="flex items-stretch overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <Stat icon={<Cube size={17} />} label="Core DLL" value={diag.core_dll_name ?? 'Not detected'} />
            <div className="w-px self-stretch bg-white/[0.06]" />
            <Stat icon={<Files size={17} />} label="Payload" value={diag.cache_found ? 'Found' : 'Not found'} />
            <div className="w-px self-stretch bg-white/[0.06]" />
            <Stat icon={<Fingerprint size={17} />} label="Fingerprint" value={diag.fingerprint.slice(0, 8)} />
          </div>

          <Section title="Patches">
            <div className="space-y-4">
              <FixRow
                icon={<CloudSlash size={20} />}
                title="Capcom Save Fix"
                blurb="Lets Capcom titles create and sync Steam Cloud saves instead of failing silently."
                state={diag.capcom_state}
                busy={busy === 'capcom'}
                disabled={busy !== null || BLOCKED.includes(diag.capcom_state)}
                onApply={() => run('capcom', 'Capcom Save Fix', () => patcherApplyCapcom(steamPath))}
              />
              <div className="border-t border-white/[0.04]" />
              <FixRow
                icon={<Lightning size={20} />}
                title="Offline Setup"
                blurb="Completes SteamTools first-run activation with no network request or retry loop."
                state={diag.offline_state}
                busy={busy === 'offline'}
                disabled={busy !== null || BLOCKED.includes(diag.offline_state)}
                onApply={() => run('offline', 'Offline Setup', () => patcherApplyOffline(steamPath))}
              />
            </div>
          </Section>

          <Section title="Maintenance">
            <FixRow
              icon={<ArrowCounterClockwise size={20} />}
              title="Restore Pristine DLLs"
              blurb="Re-downloads clean SteamTools DLLs and clears the payload cache, undoing every patch above."
              busy={busy === 'restore'}
              disabled={busy !== null}
              outline
              actionLabel="Restore"
              onApply={() => run('restore', 'Restore', () => patcherRestore(steamPath))}
            />
          </Section>
        </ScrollFade>
      )}
    </div>
  )
}
