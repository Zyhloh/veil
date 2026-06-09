import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatePresence, motion } from 'framer-motion'
import { CaretUp, ArrowsClockwise, Stop, Play, Prohibit } from '@phosphor-icons/react'
import { useInstaller } from '../lib/installer-context'

type IconType = ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; className?: string }>

interface Action {
  id: string
  label: string
  Icon: IconType
  danger?: boolean
  run: () => void
}

export default function SteamControl() {
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { setRestartRequired } = useInstaller()

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<boolean>('check_steam_running')
      setRunning(r)
      if (!r) setRestartRequired(false)
    } catch {
    }
  }, [setRestartRequired])

  useEffect(() => {
    invoke<boolean>('check_steam_running').then(setRunning).catch(() => {})
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const command = (cmd: string, optimistic: boolean) => async () => {
    setRunning(optimistic)
    setRestartRequired(false)
    await invoke(cmd).catch(() => {})
    setTimeout(refresh, 1500)
  }

  const actions: Action[] = running
    ? [
        { id: 'restart', label: 'Restart Steam', Icon: ArrowsClockwise, run: command('restart_steam', true) },
        { id: 'stop', label: 'Stop Steam', Icon: Stop, run: command('stop_steam', false) },
        { id: 'kill', label: 'Force Kill Steam', Icon: Prohibit, danger: true, run: command('kill_steam', false) },
      ]
    : [{ id: 'start', label: 'Start Steam', Icon: Play, run: command('start_steam', true) }]

  const select = (action: Action) => {
    action.run()
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold leading-none transition-colors duration-150 ${
          open ? 'bg-white/[0.06] text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-100'
        }`}
      >
        <img src="/icons/steam.png" alt="Steam" className="h-[18px] w-[18px] shrink-0 object-contain" />
        <span>Steam</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-emerald-500' : 'bg-neutral-600'}`}
          />
          <span className="text-[11px] font-medium text-neutral-500">{running ? 'Running' : 'Stopped'}</span>
          <CaretUp
            size={11}
            weight="bold"
            className={`text-neutral-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            className="absolute bottom-full left-0 mb-2 w-full origin-bottom rounded-lg border border-white/[0.08] bg-[#141414] p-1 shadow-xl shadow-black/50"
          >
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => select(action)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] font-medium leading-none transition-colors duration-100 ${
                  action.danger
                    ? 'text-neutral-400 hover:bg-red-500/10 hover:text-red-400'
                    : 'text-neutral-300 hover:bg-white/[0.05] hover:text-neutral-100'
                }`}
              >
                <action.Icon size={16} weight="bold" />
                {action.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
