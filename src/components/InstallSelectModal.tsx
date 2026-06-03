import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { listen } from '@tauri-apps/api/event'
import { X, DownloadSimple, CircleNotch, Check, Prohibit } from '@phosphor-icons/react'
import { catalogInstallSelection } from '../lib/catalog'
import { useReleasedDlc } from '../lib/dlc'
import { useMaximized } from '../lib/useMaximized'
import DlcRow from './DlcRow'
import ScrollFade from './ScrollFade'

export default function InstallSelectModal({
  appId,
  name,
  dlcAppIds,
  installedIds,
  steamPath,
  onClose,
  onInstalled,
}: {
  appId: number
  name: string
  dlcAppIds: number[]
  installedIds: Set<string>
  steamPath: string | null
  onClose: () => void
  onInstalled: () => Promise<void> | void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(installedIds.has(String(appId)) ? [] : [appId]),
  )
  const [installing, setInstalling] = useState(false)
  const [outcomes, setOutcomes] = useState<Map<number, string> | null>(null)
  const [appended, setAppended] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const { dlcIds, metas, loading: dlcLoading } = useReleasedDlc(appId, dlcAppIds)
  const maximized = useMaximized()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const unlisten = listen<{ done: number; total: number }>('selection-progress', (e) =>
      setProgress(e.payload),
    )
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const toggle = (id: number) => {
    if (installing) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allDlc = dlcIds.length > 0 && dlcIds.every((id) => selected.has(id))
  const toggleAllDlc = () => {
    if (installing) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (dlcIds.every((id) => next.has(id))) dlcIds.forEach((id) => next.delete(id))
      else dlcIds.forEach((id) => next.add(id))
      return next
    })
  }

  const statusOf = (id: number): 'busy' | 'ok' | 'fail' | null => {
    if (!selected.has(id)) return null
    if (installing) return 'busy'
    if (!outcomes) return null
    const s = outcomes.get(id)
    if (!s) return null
    return s === 'installed' || s === 'appended' ? 'ok' : 'fail'
  }

  const install = async () => {
    if (!steamPath || selected.size === 0 || installing) return
    setInstalling(true)
    setProgress(null)
    const installMain = selected.has(appId)
    const dlcs = [...selected]
      .filter((id) => id !== appId)
      .map((id) => [id, metas.get(id)?.name ?? `App ${id}`] as [number, string])
    const result = await catalogInstallSelection(steamPath, appId, installMain, dlcs).catch(() => null)
    if (result) {
      setOutcomes(new Map(result.statuses.map((s) => [s.app_id, s.status])))
      setAppended(result.appended)
    } else {
      setOutcomes(new Map())
    }
    setInstalling(false)
    setProgress(null)
    if (result) await onInstalled()
  }

  const mainStatus = statusOf(appId)

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
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] shadow-2xl shadow-black/60"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-neutral-100">Install {name}</p>
            <p className="mt-0.5 text-[11px] text-neutral-600">Choose what to add to your library.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-white/[0.06] hover:text-neutral-200 active:scale-90"
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        <ScrollFade className="flex-1 p-2.5">
          <div
            onClick={() => toggle(appId)}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.04]"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                selected.has(appId) ? 'border-neutral-200 bg-neutral-200' : 'border-white/25'
              }`}
            >
              {selected.has(appId) && <Check size={11} weight="bold" className="text-neutral-900" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-neutral-200">{name}</p>
              <p className="text-[10px] font-medium text-neutral-600">Base game · App ID {appId}</p>
            </div>
            {mainStatus === 'busy' ? (
              <CircleNotch size={15} className="shrink-0 animate-spin text-neutral-400" />
            ) : mainStatus === 'ok' ? (
              <Check size={15} weight="bold" className="shrink-0 text-emerald-500" />
            ) : mainStatus === 'fail' ? (
              <Prohibit size={15} weight="bold" className="shrink-0 text-red-400" />
            ) : null}
          </div>

          {dlcLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-neutral-600">
              <CircleNotch size={14} className="animate-spin" />
              Loading DLC…
            </div>
          ) : (
            dlcIds.length > 0 && (
              <>
                <div className="mt-2 mb-1 flex items-center justify-between px-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-600">
                    {dlcIds.length} DLC
                  </span>
                  <button
                    onClick={toggleAllDlc}
                    className="text-[11px] font-semibold text-neutral-400 transition hover:text-neutral-200 active:scale-95"
                  >
                    {allDlc ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                {dlcIds.map((id) => (
                  <DlcRow
                    key={id}
                    appId={id}
                    meta={metas.get(id)}
                    mode="check"
                    checked={selected.has(id)}
                    status={outcomes || installing ? statusOf(id) : null}
                    onSelect={() => toggle(id)}
                  />
                ))}
              </>
            )
          )}
        </ScrollFade>

        {outcomes && appended > 0 && (
          <div className="shrink-0 border-t border-amber-500/15 bg-amber-500/[0.07] px-5 py-2.5 text-[11.5px] leading-snug text-amber-300/90">
            Some DLC couldn't be fetched but were added to the Lua — they may not work correctly, but in most cases should.
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3.5">
          <span className="text-[12px] font-medium text-neutral-500">{selected.size} selected</span>
          {outcomes ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-neutral-100 px-4 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95"
            >
              Done
            </button>
          ) : (
            <button
              onClick={install}
              disabled={installing || selected.size === 0 || !steamPath}
              className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-white active:scale-95 disabled:opacity-50"
            >
              {installing ? (
                <CircleNotch size={15} weight="bold" className="animate-spin" />
              ) : (
                <DownloadSimple size={15} weight="bold" />
              )}
              {installing
                ? progress
                  ? `Installing ${progress.done}/${progress.total}`
                  : 'Installing…'
                : 'Install'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
