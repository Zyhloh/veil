import { useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'

export default function SteamArt({
  appId,
  className,
  pending = false,
}: {
  appId: number | string
  headerUrl?: string
  className?: string
  pending?: boolean
}) {
  const id = Number(appId)
  const [loaded, setLoaded] = useState(false)
  const [prevId, setPrevId] = useState(id)

  if (id !== prevId) {
    setPrevId(id)
    setLoaded(false)
  }

  return (
    <div className={`relative overflow-hidden bg-white/[0.03] ${className ?? ''}`}>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          loaded && !pending ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <CircleNotch size={18} className="animate-spin text-neutral-700" />
      </div>
      {!pending && (
        <img
          key={id}
          src={`http://veilimg.localhost/app/${id}`}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
