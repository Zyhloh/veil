import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
  }
  const hide = () => setPos(null)

  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} className="inline-flex">
      {children}
      {pos &&
        createPortal(
          <div
            style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
            className="pointer-events-none z-[200] whitespace-nowrap rounded-md border border-white/[0.08] bg-[#1c1c1c] px-2 py-1 text-[11px] font-medium text-neutral-300 shadow-lg shadow-black/50"
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  )
}
