import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  X,
  ArrowSquareOut,
  DownloadSimple,
  Check,
  CircleNotch,
  DotsThreeVertical,
  CaretLeft,
  Stack,
} from '@phosphor-icons/react'
import {
  catalogDetails,
  catalogVersions,
  catalogInstallSelection,
  type CatalogDetails,
  type CatalogVersion,
} from '../lib/catalog'
import { headerSources, openUrl } from '../lib/library'
import { useReleasedDlc } from '../lib/dlc'
import { useMaximized } from '../lib/useMaximized'
import SmartImage from './SmartImage'
import DlcRow from './DlcRow'
import ScrollFade from './ScrollFade'

const detailsCache = new Map<number, CatalogDetails>()

function useHorizontalWheel() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let target = el.scrollLeft
    let raf: number | null = null
    const stop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
    }
    const step = () => {
      const diff = target - el.scrollLeft
      if (Math.abs(diff) < 0.5) {
        el.scrollLeft = target
        raf = null
        return
      }
      el.scrollLeft += diff * 0.18
      raf = requestAnimationFrame(step)
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      if (raf === null) target = el.scrollLeft
      target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target + e.deltaY))
      if (raf === null) raf = requestAnimationFrame(step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', stop)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', stop)
      stop()
    }
  }, [])
  return ref
}

function useDetails(appId: number) {
  const [details, setDetails] = useState<CatalogDetails | null>(detailsCache.get(appId) ?? null)
  useEffect(() => {
    if (detailsCache.has(appId)) return
    let alive = true
    catalogDetails(appId)
      .then((d) => {
        if (!alive) return
        detailsCache.set(appId, d)
        setDetails(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [appId])
  return details
}

function metaLine(details: CatalogDetails | null) {
  return details
    ? [details.developers[0], details.release_date, details.price].filter(Boolean).join('  ·  ')
    : ''
}

function Screenshots({ details }: { details: CatalogDetails | null }) {
  const stripRef = useHorizontalWheel()
  return (
    <div ref={stripRef} className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {details
        ? details.screenshots.map((s) => (
            <SmartImage key={s} sources={[s]} className="h-24 w-[170px] shrink-0 rounded-md border border-white/[0.06]" />
          ))
        : [0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex h-24 w-[170px] shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.03]"
            >
              <CircleNotch size={16} className="animate-spin text-neutral-700" />
            </div>
          ))}
    </div>
  )
}

function Banner({
  appId,
  name,
  fallbackUrl,
  details,
  onBack,
  onClose,
}: {
  appId: number
  name: string
  fallbackUrl?: string
  details: CatalogDetails | null
  onBack?: () => void
  onClose: () => void
}) {
  const sources = headerSources(appId, details?.header_image || fallbackUrl)
  const generic = (s?: string) => !s || /^App \d+$/.test(s)
  const title = [details?.name, name].find((n) => !generic(n)) ?? name
  return (
    <div className="relative shrink-0">
      <SmartImage sources={sources} className="aspect-[460/215] w-full" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/25 to-transparent" />
      <h2 className="pointer-events-none absolute inset-x-5 bottom-3 truncate text-lg font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.85)]">
        {title}
      </h2>
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-neutral-300 transition hover:bg-black/70 hover:text-white active:scale-90"
        >
          <CaretLeft size={15} weight="bold" />
        </button>
      )}
      <button
        onClick={onClose}
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-neutral-300 transition hover:bg-black/70 hover:text-white active:scale-90"
      >
        <X size={15} weight="bold" />
      </button>
    </div>
  )
}

function Body({ details }: { details: CatalogDetails | null }) {
  return (
    <>
      {details ? (
        metaLine(details) && <p className="text-[12px] font-medium text-neutral-500">{metaLine(details)}</p>
      ) : (
        <div className="h-3 w-52 animate-pulse rounded bg-white/[0.05]" />
      )}
      {details && details.genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {details.genres.map((g) => (
            <span key={g} className="rounded-md border border-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-neutral-400">
              {g}
            </span>
          ))}
        </div>
      )}
      {details ? (
        details.short_description ? (
          <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">{details.short_description}</p>
        ) : (
          <p className="mt-3 text-[13px] italic text-neutral-600">No description available.</p>
        )
      ) : (
        <div className="mt-3 space-y-2">
          {['100%', '96%', '88%', '64%'].map((w) => (
            <div key={w} className="h-2.5 animate-pulse rounded bg-white/[0.04]" style={{ width: w }} />
          ))}
        </div>
      )}
    </>
  )
}

function Footer({
  appId,
  installed,
  steamPath,
  onInstall,
  onConfigure,
  extra,
}: {
  appId: number
  installed: boolean
  steamPath: string | null
  onInstall: (appId: number) => Promise<boolean | 'missing'>
  onConfigure?: () => void
  extra?: ReactNode
}) {
  const [installing, setInstalling] = useState(false)
  const [localDone, setLocalDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [missing, setMissing] = useState(false)
  const done = installed || localDone
  const install = async () => {
    if (!steamPath || installing || done) return
    setInstalling(true)
    setFailed(false)
    setMissing(false)
    const res = await onInstall(appId)
    setInstalling(false)
    if (res === true) setLocalDone(true)
    else if (res === 'missing') {
      setMissing(true)
      setTimeout(() => setMissing(false), 3000)
    } else {
      setFailed(true)
      setTimeout(() => setFailed(false), 3000)
    }
  }
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3.5">
      <button
        onClick={() => openUrl(`https://store.steampowered.com/app/${appId}`).catch(() => {})}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-neutral-400 transition hover:bg-white/[0.05] hover:text-neutral-200 active:scale-95"
      >
        <ArrowSquareOut size={15} weight="bold" />
        Steam Page
      </button>
      <div className="flex items-center gap-2">
        {done ? (
          <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3.5 py-2 text-[12.5px] font-semibold text-emerald-400">
            <Check size={15} weight="bold" />
            In Library
          </span>
        ) : onConfigure ? (
          <button
            onClick={onConfigure}
            disabled={!steamPath}
            className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-50"
          >
            <DownloadSimple size={15} weight="bold" />
            Add to Library
          </button>
        ) : missing ? (
          <span className="flex cursor-not-allowed items-center rounded-lg border border-red-500/25 bg-red-500/15 px-3.5 py-2 text-[12.5px] font-semibold text-red-300">
            Missing Base App Lua
          </span>
        ) : failed ? (
          <span className="flex cursor-not-allowed items-center rounded-lg border border-red-500/25 bg-red-500/15 px-3.5 py-2 text-[12.5px] font-semibold text-red-300">
            Unavailable
          </span>
        ) : (
          <button
            onClick={install}
            disabled={installing || !steamPath}
            className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-50"
          >
            {installing ? <CircleNotch size={15} weight="bold" className="animate-spin" /> : <DownloadSimple size={15} weight="bold" />}
            {installing ? 'Installing…' : 'Add to Library'}
          </button>
        )}
        {extra}
      </div>
    </div>
  )
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[#0f0f0f]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="flex h-full flex-col">
        {children}
      </motion.div>
    </div>
  )
}

function SheetHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
      <button
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-neutral-400 transition hover:bg-white/[0.05] hover:text-neutral-200 active:scale-90"
      >
        <CaretLeft size={15} weight="bold" />
      </button>
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-neutral-100">{title}</p>
        <p className="truncate text-[11px] text-neutral-600">{subtitle}</p>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-neutral-600">{children}</div>
}

function DlcListView({
  appId,
  gridDlcIds,
  name,
  onBack,
  onOpen,
}: {
  appId: number
  gridDlcIds: number[]
  name: string
  onBack: () => void
  onOpen: (id: number, name: string, headerUrl?: string) => void
}) {
  const { dlcIds, metas, loading } = useReleasedDlc(appId, gridDlcIds)
  return (
    <Sheet>
      <SheetHeader
        title="DLC"
        subtitle={loading ? `Loading DLC for ${name}…` : `${dlcIds.length} available for ${name}`}
        onBack={onBack}
      />
      {loading ? (
        <Centered>
          <CircleNotch size={16} className="animate-spin" /> Loading DLC…
        </Centered>
      ) : dlcIds.length === 0 ? (
        <Centered>No DLC available</Centered>
      ) : (
        <ScrollFade className="flex-1 p-3" contentClassName="space-y-0.5">
          {dlcIds.map((id) => {
            const m = metas.get(id)
            return (
              <DlcRow
                key={id}
                appId={id}
                meta={m}
                mode="open"
                onSelect={() => onOpen(id, m?.name ?? `App ${id}`, m?.header_url || undefined)}
              />
            )
          })}
        </ScrollFade>
      )}
    </Sheet>
  )
}

function DlcDetailView({
  appId,
  name,
  headerUrl,
  installed,
  steamPath,
  onInstallDlc,
  onBack,
  onClose,
}: {
  appId: number
  name: string
  headerUrl?: string
  installed: boolean
  steamPath: string | null
  onInstallDlc: (dlcId: number, dlcName: string) => Promise<boolean | 'missing'>
  onBack: () => void
  onClose: () => void
}) {
  const details = useDetails(appId)
  return (
    <Sheet>
      <Banner appId={appId} name={name} fallbackUrl={headerUrl} details={details} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <Body details={details} />
        <Screenshots details={details} />
      </div>
      <Footer
        appId={appId}
        installed={installed}
        steamPath={steamPath}
        onInstall={(id) => onInstallDlc(id, name)}
      />
    </Sheet>
  )
}

type View =
  | { t: 'versions' }
  | { t: 'dlcList' }
  | { t: 'dlcDetail'; appId: number; name: string; headerUrl?: string }

export default function CatalogDetailsModal({
  appId,
  name,
  headerUrl,
  dlcAppIds,
  installedIds,
  steamPath,
  onClose,
  onInstall,
  onInstallAt,
  onInstalled,
  onSelectInstall,
}: {
  appId: number
  name: string
  headerUrl?: string
  dlcAppIds: number[]
  installedIds: Set<string>
  steamPath: string | null
  onClose: () => void
  onInstall: (appId: number) => Promise<boolean>
  onInstallAt: (appId: number, sha: string) => Promise<boolean>
  onInstalled?: () => Promise<void> | void
  onSelectInstall: () => void
}) {
  const details = useDetails(appId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stack, setStack] = useState<View[]>([])
  const [versions, setVersions] = useState<CatalogVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [installingSha, setInstallingSha] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const maximized = useMaximized()
  const top = stack[stack.length - 1]
  const push = (v: View) => setStack((s) => [...s, v])
  const back = () => setStack((s) => s.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (stack.length > 0) back()
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, stack.length])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [menuOpen])

  const installed = installedIds.has(String(appId))
  const hasDlc = dlcAppIds.length > 0 || (details?.dlc_app_ids.length ?? 0) > 0

  const installDlc = async (dlcId: number, dlcName: string): Promise<boolean | 'missing'> => {
    if (!steamPath) return false
    const result = await catalogInstallSelection(steamPath, appId, false, [[dlcId, dlcName]]).catch(() => null)
    const status = result?.statuses.find((s) => s.app_id === dlcId)?.status
    if (status === 'installed' || status === 'appended') {
      await onInstalled?.()
      return true
    }
    return status === 'missing_base' ? 'missing' : false
  }

  const openVersions = () => {
    setMenuOpen(false)
    push({ t: 'versions' })
    if (versions.length === 0 && !versionsLoading) {
      setVersionsLoading(true)
      catalogVersions(appId)
        .then((v) => {
          setVersions(v)
          setVersionsLoading(false)
        })
        .catch(() => setVersionsLoading(false))
    }
  }

  const installVersion = async (sha: string) => {
    if (!steamPath || installingSha) return
    setInstallingSha(sha)
    const ok = await onInstallAt(appId, sha)
    setInstallingSha(null)
    if (ok) back()
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      onMouseDown={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] shadow-2xl shadow-black/60"
      >
        <Banner appId={appId} name={name} fallbackUrl={headerUrl} details={details} onClose={onClose} />

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Body details={details} />

          {hasDlc && (
            <button
              onClick={() => push({ t: 'dlcList' })}
              className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[12.5px] font-semibold text-neutral-300 transition hover:border-white/[0.12] hover:bg-white/[0.04] active:scale-[0.99]"
            >
              <span className="flex items-center gap-2">
                <Stack size={15} weight="bold" />
                View DLC
              </span>
              <CaretLeft size={14} weight="bold" className="rotate-180 text-neutral-600" />
            </button>
          )}

          <Screenshots details={details} />
        </div>

        <Footer
          appId={appId}
          installed={installed}
          steamPath={steamPath}
          onInstall={onInstall}
          onConfigure={hasDlc ? onSelectInstall : undefined}
          extra={
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] text-neutral-400 transition hover:bg-white/[0.05] hover:text-neutral-200 active:scale-90"
              >
                <DotsThreeVertical size={18} weight="bold" />
              </button>
              {menuOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-white/[0.08] bg-[#161616] p-1 shadow-xl shadow-black/50">
                  <button
                    onClick={openVersions}
                    className="flex w-full items-center rounded-md px-2.5 py-2 text-[12.5px] font-medium text-neutral-300 transition hover:bg-white/[0.05] hover:text-neutral-100 active:scale-[0.98]"
                  >
                    Install Older Version
                  </button>
                </div>
              )}
            </div>
          }
        />

        {top?.t === 'versions' && (
          <Sheet>
            <SheetHeader title="Versions" subtitle={`Install a specific build of ${name}`} onBack={back} />
            {versionsLoading ? (
              <Centered>
                <CircleNotch size={16} className="animate-spin" /> Loading versions…
              </Centered>
            ) : versions.length === 0 ? (
              <Centered>No older versions available</Centered>
            ) : (
              <ScrollFade className="flex-1 p-3" contentClassName="space-y-1.5">
                {versions.map((v, i) => (
                    <button
                      key={v.sha}
                      onClick={() => installVersion(v.sha)}
                      disabled={installingSha !== null}
                      className="group flex w-full items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04] active:scale-[0.99] disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-neutral-100">Build {v.build_id}</span>
                          {i === 0 && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                              Latest
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-neutral-600">
                          {v.date.slice(0, 10)} · {v.short_sha}
                        </p>
                      </div>
                      {installingSha === v.sha ? (
                        <CircleNotch size={16} className="shrink-0 animate-spin text-neutral-300" />
                      ) : (
                        <DownloadSimple size={16} weight="bold" className="shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-200" />
                      )}
                    </button>
                  ))}
              </ScrollFade>
            )}
          </Sheet>
        )}

        {top?.t === 'dlcList' && (
          <DlcListView
            appId={appId}
            gridDlcIds={dlcAppIds}
            name={name}
            onBack={back}
            onOpen={(id, dlcName, dlcHeader) => push({ t: 'dlcDetail', appId: id, name: dlcName, headerUrl: dlcHeader })}
          />
        )}

        {top?.t === 'dlcDetail' && (
          <DlcDetailView
            appId={top.appId}
            name={top.name}
            headerUrl={top.headerUrl}
            installed={installedIds.has(String(top.appId))}
            steamPath={steamPath}
            onInstallDlc={installDlc}
            onBack={back}
            onClose={onClose}
          />
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
