import { useEffect, useRef, useState, type RefObject } from 'react'
import { getAppsMeta, type AppMeta } from './library'
import { catalogDetails } from './catalog'

export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView])

  return [ref, inView]
}

interface ReleasedDlc {
  dlcIds: number[]
  metas: Map<number, AppMeta>
  loading: boolean
}

export function useReleasedDlc(appId: number, gridDlcIds: number[], enabled = true): ReleasedDlc {
  const [result, setResult] = useState<ReleasedDlc>({ dlcIds: [], metas: new Map(), loading: true })
  const gridKey = gridDlcIds.join(',')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    ;(async () => {
      const [details, mainMetas] = await Promise.all([
        catalogDetails(appId).catch(() => null),
        getAppsMeta([appId]).catch(() => [] as AppMeta[]),
      ])
      const union = new Set<number>(gridKey ? gridKey.split(',').map(Number) : [])
      details?.dlc_app_ids.forEach((id) => union.add(id))
      mainMetas[0]?.dlc_app_ids.forEach((id) => union.add(id))
      const ids = [...union]
      const metas = await getAppsMeta(ids).catch(() => [] as AppMeta[])
      if (!alive) return
      const metaMap = new Map(metas.map((m) => [m.app_id, m]))
      const released = ids.filter((id) => metaMap.get(id)?.released)
      setResult({ dlcIds: released, metas: metaMap, loading: false })
    })()
    return () => {
      alive = false
    }
  }, [appId, gridKey, enabled])

  return result
}
