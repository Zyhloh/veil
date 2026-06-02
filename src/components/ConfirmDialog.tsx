import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Warning, Question } from '@phosphor-icons/react'
import { useMaximized } from '../lib/useMaximized'

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  icon,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  icon?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const maximized = useMaximized()
  const badge = icon ?? (danger ? <Warning size={20} weight="bold" /> : <Question size={20} weight="bold" />)

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      onMouseDown={onCancel}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${maximized ? 'rounded-none' : 'rounded-[10px]'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[400px] rounded-2xl border border-white/[0.07] bg-[#161616] p-6 shadow-2xl shadow-black/60"
      >
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 text-neutral-600 transition-colors hover:text-neutral-300"
        >
          <X size={16} weight="bold" />
        </button>

        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
            danger
              ? 'border-red-500/20 bg-red-500/10 text-red-400'
              : 'border-white/10 bg-white/[0.05] text-neutral-300'
          }`}
        >
          {badge}
        </div>

        <h3 className="mt-4 text-[16px] font-bold text-neutral-100">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">{message}</p>

        <div className="mt-6 flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2.5 text-[13px] font-semibold text-neutral-300 transition-colors hover:bg-white/[0.07] hover:text-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-colors ${
              danger
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-neutral-100 text-neutral-900 hover:bg-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
