import { Cube, GameController, CaretRight } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

type IconType = ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; className?: string }>

interface FixEntry {
  id: string
  title: string
  desc: string
  Icon: IconType
}

const ENTRIES: FixEntry[] = [
  {
    id: 'Patcher',
    title: 'SteamTools DLL Patches',
    desc: 'Capcom cloud-save fix, offline first-run setup, and restore for the SteamTools core DLL.',
    Icon: Cube,
  },
  {
    id: 'ForzaFix',
    title: 'Forza Horizon 6 Fixer',
    desc: 'Repair the Xbox Gaming Services component required by Forza Horizon 6 on Steam.',
    Icon: GameController,
  },
]

export default function FixesPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="mb-5 shrink-0">
        <h2 className="text-2xl font-bold text-neutral-100">Fixes</h2>
        <p className="mt-1 text-sm text-neutral-500">Patches and game-specific repair tools.</p>
      </div>

      <div className="flex flex-col gap-2.5">
        {ENTRIES.map((entry) => {
          const { Icon } = entry
          return (
            <button
              key={entry.id}
              onClick={() => onNavigate(entry.id)}
              className="group flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/[0.1] hover:bg-white/[0.035]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-neutral-300 transition-colors group-hover:text-neutral-100">
                <Icon size={22} weight="regular" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-neutral-100">{entry.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">{entry.desc}</p>
              </div>
              <CaretRight
                size={18}
                weight="bold"
                className="shrink-0 text-neutral-600 transition-all group-hover:translate-x-0.5 group-hover:text-neutral-300"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
