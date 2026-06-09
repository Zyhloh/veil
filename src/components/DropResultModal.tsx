import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Check, Prohibit, WarningCircle } from '@phosphor-icons/react'
import { useMaximized } from '../lib/useMaximized'
import ScrollFade from './ScrollFade'
import type { DropResult } from '../lib/installer-context'

function Group({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={`mb-2 text-[10px] font-bold uppercase tracking-[0.14em] ${color}`}>{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export default function DropResultModal({ result, onClose }: { result: DropResult; onClose: () => void }) {
  const maximized = useMaximized()

  const addedGroups = result.added.filter((g) => g.dlcs.length > 0)
  const totalAdded = addedGroups.reduce((n, g) => n + g.dlcs.length, 0)
  const gamesOk = result.games.filter((g) => g.ok)
  const gamesFail = result.games.filter((g) => !g.ok)

  const done: string[] = []
  if (totalAdded > 0) done.push(`${totalAdded} DLC added`)
  if (gamesOk.length > 0) done.push(`${gamesOk.length} game${gamesOk.length > 1 ? 's' : ''} installed`)
  const summary = done.length > 0 ? done.join(' · ') : 'Some items need attention'

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      onMouseDown={onClose}
      className={`fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[78vh] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#161616] shadow-2xl shadow-black/60"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-neutral-600 transition-colors hover:text-neutral-300"
        >
          <X size={16} weight="bold" />
        </button>

        <div className="px-6 pt-6">
          <h3 className="pr-8 text-[16px] font-bold text-neutral-100">Drop results</h3>
          <p className="mt-1 text-[13px] text-neutral-500">{summary}</p>
        </div>

        <ScrollFade className="mt-5 px-6" contentClassName="space-y-5 pb-1">
          {result.missing.length > 0 && (
            <Group label="Base game not installed" color="text-red-400/90">
              {result.missing.map((g) => (
                <div key={g.parentId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Prohibit size={14} weight="bold" className="shrink-0 text-red-400" />
                    <p className="truncate text-[12.5px] font-semibold text-neutral-200">{g.parentName}</p>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
                    Install it first, then re-drop to add {g.dlcs.length} DLC: {g.dlcs.map((d) => d.name).join(', ')}
                  </p>
                </div>
              ))}
            </Group>
          )}

          {addedGroups.length > 0 && (
            <Group label="DLC added" color="text-emerald-400/90">
              {addedGroups.map((g) => (
                <div key={g.parentId} className="flex items-center gap-2">
                  <Check size={14} weight="bold" className="shrink-0 text-emerald-500" />
                  <p className="truncate text-[12.5px] text-neutral-300">
                    <span className="font-semibold text-neutral-100">{g.parentName}</span>
                    <span className="text-neutral-600"> · {g.dlcs.length} DLC</span>
                  </p>
                </div>
              ))}
            </Group>
          )}

          {gamesOk.length > 0 && (
            <Group label="Games installed" color="text-emerald-400/90">
              {gamesOk.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <Check size={14} weight="bold" className="shrink-0 text-emerald-500" />
                  <p className="truncate text-[12.5px] text-neutral-300">{g.name}</p>
                </div>
              ))}
            </Group>
          )}

          {gamesFail.length > 0 && (
            <Group label="No manifest available" color="text-amber-400/90">
              {gamesFail.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <WarningCircle size={14} weight="bold" className="shrink-0 text-amber-400" />
                  <p className="truncate text-[12.5px] text-neutral-400">
                    {g.name}
                    <span className="text-neutral-600"> · {g.id}</span>
                  </p>
                </div>
              ))}
            </Group>
          )}

          {result.already.length > 0 && (
            <Group label="Already in your library" color="text-neutral-500">
              {result.already.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <Check size={14} weight="bold" className="shrink-0 text-neutral-500" />
                  <p className="truncate text-[12.5px] text-neutral-400">{g.name}</p>
                </div>
              ))}
            </Group>
          )}

          {result.unknown.length > 0 && (
            <Group label="Couldn't identify" color="text-neutral-500">
              <div className="flex flex-wrap gap-1.5">
                {result.unknown.map((id) => (
                  <span
                    key={id}
                    className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-neutral-400"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </Group>
          )}
        </ScrollFade>

        <div className="p-6 pt-5">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-neutral-100 py-2.5 text-[13px] font-semibold text-neutral-900 transition-colors hover:bg-white"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
