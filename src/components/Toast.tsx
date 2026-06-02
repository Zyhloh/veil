import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useInstaller } from '../lib/installer-context'

const EASE = [0.25, 0.46, 0.45, 0.94] as const

export default function Toast() {
  const { toast, clearToast } = useInstaller()
  const success = toast?.kind === 'success'

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200]">
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="pointer-events-auto w-fit max-w-[360px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414] shadow-2xl shadow-black/60"
          >
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              {success ? (
                <CheckCircle size={17} weight="fill" className="shrink-0 text-emerald-400" />
              ) : (
                <WarningCircle size={17} weight="fill" className="shrink-0 text-amber-400" />
              )}
              <p className="min-w-0 truncate text-[12.5px] font-medium text-neutral-200">{toast.message}</p>
            </div>
            <div className="h-0.5 w-full bg-white/[0.05]">
              <motion.div
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 3, ease: 'linear' }}
                onAnimationComplete={() => clearToast(toast.id)}
                className={`h-full ${success ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
