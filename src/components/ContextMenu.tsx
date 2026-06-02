import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

export type MenuEntry =
  | 'divider'
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (ref.current && ref.current.contains(target)) return
      if (target.closest('[data-ctx-trigger]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const width = 196
  const estHeight = items.length * 34
  const left = Math.min(x, window.innerWidth - width - 8)
  const top = Math.min(y, window.innerHeight - estHeight - 8)

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      style={{ left, top, width }}
      className="fixed z-50 origin-top-left rounded-lg border border-white/[0.08] bg-[#141414] p-1 shadow-xl shadow-black/50"
    >
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={i} className="my-1 border-t border-white/[0.06]" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={`flex w-full items-center rounded-md px-2.5 py-2 text-[12.5px] font-medium leading-none transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-30 ${
              item.danger
                ? 'text-neutral-300 hover:bg-red-500/10 hover:text-red-400'
                : 'text-neutral-300 hover:bg-white/[0.05] hover:text-neutral-100'
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </motion.div>,
    document.body,
  )
}
