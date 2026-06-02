import { useEffect, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { imageSrc } from '../lib/images'

export default function SmartImage({
  sources,
  className,
  pending = false,
  onExhausted,
}: {
  sources: string[]
  className?: string
  pending?: boolean
  onExhausted?: () => void
}) {
  const key = sources.join('|')
  const [prevKey, setPrevKey] = useState(key)
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)

  if (key !== prevKey) {
    setPrevKey(key)
    setIndex(0)
    setLoaded(false)
  }

  const src = index < sources.length ? imageSrc(sources[index]) : null

  useEffect(() => {
    if (!src || loaded) return
    const timer = setTimeout(() => setIndex((i) => i + 1), 8000)
    return () => clearTimeout(timer)
  }, [src, loaded])

  useEffect(() => {
    if (src === null && sources.length > 0 && !pending) onExhausted?.()
  }, [src, sources.length, pending, onExhausted])

  if (!src) {
    const showPlaceholder = !pending
    return (
      <div className={`relative overflow-hidden bg-white/[0.03] ${className ?? ''}`}>
        {showPlaceholder ? (
          <img src="/icons/placeholder.svg" alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CircleNotch size={18} className="animate-spin text-neutral-700" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden bg-white/[0.03] ${className ?? ''}`}>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${loaded ? 'opacity-0' : 'opacity-100'}`}
      >
        <CircleNotch size={18} className="animate-spin text-neutral-700" />
      </div>
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setIndex((i) => i + 1)}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}
