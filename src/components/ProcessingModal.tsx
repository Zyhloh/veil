import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { CircleNotch } from '@phosphor-icons/react'
import { useMaximized } from '../lib/useMaximized'

export default function ProcessingModal({ label }: { label: string }) {
  const maximized = useMaximized()

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        className="flex max-w-[300px] flex-col items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-[#161616] px-9 py-7 shadow-2xl shadow-black/60"
      >
        <CircleNotch size={26} weight="bold" className="animate-spin text-neutral-300" />
        <p className="line-clamp-2 text-center text-[12.5px] font-semibold leading-relaxed text-neutral-300">
          {label}
        </p>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
