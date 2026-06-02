import { useMemo } from 'react'
import { Check, CaretRight, Prohibit, CircleNotch } from '@phosphor-icons/react'
import { headerSources, type AppMeta } from '../lib/library'
import SmartImage from './SmartImage'

export default function DlcRow({
  appId,
  meta,
  mode,
  checked,
  status,
  onSelect,
}: {
  appId: number
  meta?: AppMeta
  mode: 'check' | 'open'
  checked?: boolean
  status?: 'busy' | 'ok' | 'fail' | null
  onSelect: () => void
}) {
  const sources = useMemo(() => headerSources(appId, meta?.header_url || undefined), [appId, meta?.header_url])

  return (
    <div
      onClick={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.04]"
    >
      {mode === 'check' && (
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            checked ? 'border-neutral-200 bg-neutral-200' : 'border-white/25'
          }`}
        >
          {checked && <Check size={11} weight="bold" className="text-neutral-900" />}
        </span>
      )}
      <SmartImage sources={sources} className="h-9 w-16 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-neutral-200">{meta?.name ?? `App ${appId}`}</p>
        <p className="text-[10px] font-medium text-neutral-600">App ID {appId}</p>
      </div>
      {status === 'busy' ? (
        <CircleNotch size={15} className="shrink-0 animate-spin text-neutral-400" />
      ) : status === 'ok' ? (
        <Check size={15} weight="bold" className="shrink-0 text-emerald-500" />
      ) : status === 'fail' ? (
        <Prohibit size={15} weight="bold" className="shrink-0 text-red-400" />
      ) : mode === 'open' ? (
        <CaretRight size={15} weight="bold" className="shrink-0 text-neutral-600" />
      ) : null}
    </div>
  )
}
