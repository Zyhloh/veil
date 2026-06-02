import { useEffect, useRef, useState, type ReactNode } from 'react'

export default function ScrollFade({
  className,
  contentClassName,
  children,
}: {
  className?: string
  contentClassName?: string
  children: ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const update = () => {
      setAtTop(el.scrollTop <= 1)
      setAtBottom(Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)
    }
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  const top = atTop ? '#000 0' : 'transparent 0, #000 22px'
  const bottom = atBottom ? '#000 100%' : '#000 calc(100% - 22px), transparent 100%'
  const mask = `linear-gradient(to bottom, ${top}, ${bottom})`

  return (
    <div
      ref={scrollerRef}
      className={`overflow-y-auto ${className ?? ''}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </div>
  )
}
