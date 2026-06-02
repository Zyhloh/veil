import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, getAllWindows } from '@tauri-apps/api/window'
import { useStartupChecks } from '../hooks/useStartupChecks'

export default function Splash() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    const poll = () => {
      invoke<boolean>('is_main_ready')
        .then((r) => {
          if (!alive) return
          if (r) setReady(true)
          else setTimeout(poll, 150)
        })
        .catch(() => {
          if (alive) setTimeout(poll, 150)
        })
    }
    poll()
    return () => {
      alive = false
    }
  }, [])

  const handoff = useCallback(async () => {
    const windows = await getAllWindows()
    await windows.find((w) => w.label === 'main')?.show()
    await getCurrentWindow().close()
  }, [])

  const { progress, label } = useStartupChecks(ready, handoff)

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 flex flex-col items-center justify-between overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#0a0a0a] px-6 pb-6 pt-9"
    >
      <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-4">
        <motion.img
          src="/veil.png"
          alt="Veil"
          className="h-14 w-14 object-contain"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <h1 className="pl-[0.4em] text-2xl font-extrabold tracking-[0.4em] text-neutral-100">VEIL</h1>
      </div>

      <div className="pointer-events-none w-full rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-medium">
          <motion.span
            key={label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="text-neutral-400"
          >
            {label}
          </motion.span>
          <span className="tabular-nums text-neutral-600">{Math.round(progress)}%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-neutral-100"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'easeOut', duration: 0.5 }}
          />
        </div>
      </div>
    </div>
  )
}
