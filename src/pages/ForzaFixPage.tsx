import { useCallback, useEffect, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import {
  DownloadSimple,
  CircleNotch,
  CheckCircle,
  ArrowSquareOut,
  FolderOpen,
  Warning,
  ArrowLeft,
  ArrowsClockwise,
  XCircle,
} from '@phosphor-icons/react'
import ScrollFade from '../components/ScrollFade'
import { useInstaller } from '../lib/installer-context'
import { openFolder, openUrl } from '../lib/library'
import {
  listGamingTools,
  downloadGamingTool,
  runGamingTool,
  gamingServicesVersion,
  type ToolFile,
} from '../lib/tools'

const TOOL_NAME = 'GamingRepairTool.exe'
const STORE_URL = 'https://www.microsoft.com/store/productId/9MWPM2CQNLHN?ocid=libraryshare'
const MIN_VERSION = '36.113.2002.0'

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

type VersionState =
  | { status: 'loading' }
  | { status: 'ok'; version: string }
  | { status: 'outdated'; version: string }
  | { status: 'missing' }
  | { status: 'unknown' }

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : path
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-[10px] font-bold text-neutral-400">
        {n}
      </span>
      <span className="text-[12.5px] leading-relaxed text-neutral-400">{children}</span>
    </li>
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

function VersionStatus({ state, onRecheck }: { state: VersionState; onRecheck: () => void }) {
  const recheck = (
    <button
      onClick={onRecheck}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-300 transition hover:bg-white/[0.05]"
    >
      <ArrowsClockwise size={13} weight="bold" />
      Re-check
    </button>
  )

  const config =
    state.status === 'loading'
      ? { wrap: 'border-white/[0.06] bg-white/[0.02]', icon: <CircleNotch size={18} className="animate-spin text-neutral-500" />, title: 'Checking installed version…', body: 'Reading your current Gaming Services version.' }
      : state.status === 'ok'
        ? { wrap: 'border-emerald-400/15 bg-emerald-400/[0.05]', icon: <CheckCircle size={18} weight="fill" className="text-emerald-400" />, title: 'Gaming Services is up to date', body: `Installed version ${state.version} meets the minimum of ${MIN_VERSION}. No fix needed.` }
        : state.status === 'outdated'
          ? { wrap: 'border-amber-400/20 bg-amber-400/[0.06]', icon: <Warning size={18} weight="fill" className="text-amber-400" />, title: 'Gaming Services is out of date', body: `Installed version ${state.version} is below the minimum of ${MIN_VERSION}. Run the repair tool or update it to fix Forza Horizon 6.` }
          : state.status === 'missing'
            ? { wrap: 'border-amber-400/20 bg-amber-400/[0.06]', icon: <XCircle size={18} weight="fill" className="text-amber-400" />, title: 'Gaming Services not detected', body: 'Gaming Services does not appear to be installed. Install it from the Microsoft Store or run the repair tool.' }
            : { wrap: 'border-white/[0.06] bg-white/[0.02]', icon: <Warning size={18} weight="fill" className="text-neutral-500" />, title: "Couldn't check the version", body: 'Veil was unable to read your installed Gaming Services version.' }

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${config.wrap}`}>
      <span className="shrink-0">{config.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-neutral-100">{config.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-400">{config.body}</p>
      </div>
      {state.status !== 'loading' && recheck}
    </div>
  )
}

export default function ForzaFixPage({ onBack }: { onBack: () => void }) {
  const { notify } = useInstaller()
  const [tool, setTool] = useState<ToolFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [version, setVersion] = useState<VersionState>({ status: 'loading' })

  const checkVersion = useCallback(() => {
    setVersion({ status: 'loading' })
    gamingServicesVersion()
      .then((v) => {
        if (!v) {
          setVersion({ status: 'missing' })
          return
        }
        setVersion(compareVersion(v, MIN_VERSION) >= 0 ? { status: 'ok', version: v } : { status: 'outdated', version: v })
      })
      .catch(() => setVersion({ status: 'unknown' }))
  }, [])

  useEffect(() => {
    let alive = true
    listGamingTools()
      .then((files) => {
        if (!alive) return
        setTool(files.find((f) => f.name === TOOL_NAME) ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    checkVersion()
  }, [checkVersion])

  const download = useCallback(async () => {
    if (busy) return
    const dest = await save({
      defaultPath: TOOL_NAME,
      filters: [{ name: 'Application', extensions: ['exe'] }],
    }).catch(() => null)
    if (!dest) return
    setBusy(true)
    setSavedPath(null)
    try {
      const path = await downloadGamingTool(TOOL_NAME, dest)
      setSavedPath(path)
      await runGamingTool(path)
      notify('success', 'Repair Tool downloaded and launched.')
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, notify])

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="mb-5 shrink-0">
        <button
          onClick={onBack}
          className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <ArrowLeft size={14} weight="bold" />
          Fixes
        </button>
        <h2 className="text-2xl font-bold text-neutral-100">Forza Horizon 6 Fixer</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Repairs the Xbox Gaming Services component required by Forza Horizon 6 on Steam.
        </p>
      </div>

      <ScrollFade className="flex-1 pr-1" contentClassName="space-y-3 py-0.5">
        <VersionStatus state={version} onRecheck={checkVersion} />

        <div className="overflow-hidden rounded-xl border border-amber-400/15 bg-amber-400/[0.04]">
          <div className="flex items-start gap-3 px-5 pb-4 pt-4">
            <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-neutral-100">Invalid Gaming Services Detected</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
                If Forza Horizon 6 shows the error below on launch, your system has an outdated version of
                Gaming Services. Run the repair tool or update it manually — both methods are below.
              </p>
            </div>
          </div>
          <div className="border-t border-amber-400/10 bg-black/20 px-5 py-4">
            <img
              src="/images/invalidgamingservices.png"
              alt="Invalid Gaming Services Detected"
              className="mx-auto w-full max-w-[440px] rounded-lg border border-white/[0.06]"
            />
          </div>
        </div>

        <Section title="Repair Tool">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-neutral-300">
              <DownloadSimple size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-neutral-100">Gaming Services Repair Tool</p>
              <p className="mt-0.5 text-[11.5px] text-neutral-500">
                Microsoft's official repair utility{tool ? ` · ${formatSize(tool.size)}` : ''}
              </p>
            </div>
            <button
              onClick={download}
              disabled={busy}
              className="flex h-9 w-[150px] shrink-0 items-center justify-center gap-2 rounded-lg bg-neutral-100 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-neutral-600"
            >
              {busy ? <CircleNotch size={15} weight="bold" className="animate-spin" /> : 'Download & Run'}
            </button>
          </div>

          {savedPath && (
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-3.5 py-2.5">
              <CheckCircle size={16} weight="fill" className="shrink-0 text-emerald-400" />
              <p className="min-w-0 flex-1 truncate text-[12px] text-neutral-300">{savedPath}</p>
              <button
                onClick={() => openFolder(parentDir(savedPath)).catch(() => {})}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-300 transition hover:bg-white/[0.05]"
              >
                <FolderOpen size={14} weight="bold" />
                Open Folder
              </button>
            </div>
          )}

          <ol className="mt-4 space-y-2.5">
            <Step n={1}>
              Click Download &amp; Run and choose where to save the tool — Veil downloads it and launches it for
              you automatically.
            </Step>
            <Step n={2}>
              A command prompt opens and automatically runs checks, then installs the needed Gaming Services
              updates for your PC.
            </Step>
            <Step n={3}>
              When it finishes, type <span className="font-semibold text-neutral-200">Y</span> or{' '}
              <span className="font-semibold text-neutral-200">N</span> and press Enter to leave feedback on how
              the tool worked.
            </Step>
            <Step n={4}>Once repaired, launch Forza Horizon 6 again and enjoy.</Step>
          </ol>
        </Section>

        <Section title="Manual Update via Microsoft Store">
          <p className="text-[12.5px] leading-relaxed text-neutral-400">
            Steam players need an up-to-date Gaming Services component before playing. This applies to both the
            Xbox app and Steam versions of the game.
          </p>
          <ol className="mt-3 space-y-2.5">
            <Step n={1}>
              Open the Microsoft Store (press the Windows key and type{' '}
              <span className="font-semibold text-neutral-200">Store</span>).
            </Step>
            <Step n={2}>Click Downloads in the lower-left of the Store app.</Step>
            <Step n={3}>Click Check for updates in the top-right of the Updates &amp; downloads page.</Step>
            <Step n={4}>Find Gaming Services in the list and click Update.</Step>
          </ol>
          <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
            If it's already current, you'll only see an Open option or an Installed label. If Gaming Services
            isn't listed, install it directly from the Store.
          </p>
          <button
            onClick={() => openUrl(STORE_URL).catch(() => {})}
            className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.08] px-3.5 py-2 text-[12.5px] font-semibold text-neutral-200 transition hover:bg-white/[0.05]"
          >
            <ArrowSquareOut size={15} weight="bold" />
            Open Gaming Services in the Microsoft Store
          </button>
        </Section>

        <Section title="Check Your Installed Version">
          <p className="text-[12.5px] leading-relaxed text-neutral-400">
            The minimum supported version is{' '}
            <span className="font-semibold text-neutral-200">{MIN_VERSION}</span> or greater.
          </p>
          <ol className="mt-3 space-y-2.5">
            <Step n={1}>
              Open Settings (press the Windows key and type{' '}
              <span className="font-semibold text-neutral-200">Settings</span>).
            </Step>
            <Step n={2}>Go to Apps, then Installed apps.</Step>
            <Step n={3}>
              Search for <span className="font-semibold text-neutral-200">Gaming Services</span>.
            </Step>
            <Step n={4}>Click the "..." button and choose Advanced options.</Step>
            <Step n={5}>
              The version number shown must be {MIN_VERSION} or greater.
            </Step>
          </ol>
        </Section>

        <p className="px-1 pb-1 pt-1 text-center text-[11.5px] text-neutral-600">
          Still seeing the error after both methods? Open a ticket in the Veil Discord server and we'll help you
          out.
        </p>
      </ScrollFade>
    </div>
  )
}
