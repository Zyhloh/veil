import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

export function useStartupChecks(ready: boolean, onComplete: () => void) {
  const [progress, setProgress] = useState(8)
  const [label, setLabel] = useState('Starting Veil')

  useEffect(() => {
    const unlisten = listen<{ label: string; pct: number }>('startup:progress', (e) => {
      if (typeof e.payload?.pct === 'number') setProgress((p) => Math.max(p, e.payload.pct))
      if (e.payload?.label) setLabel(e.payload.label)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Gentle drift so the bar never looks frozen before the first event lands.
  useEffect(() => {
    if (ready) return
    const t = setInterval(() => setProgress((p) => (p < 90 ? p + 0.5 : p)), 400)
    return () => clearInterval(t)
  }, [ready])

  useEffect(() => {
    if (!ready) return
    const fill = setTimeout(() => {
      setProgress(100)
      setLabel('Ready')
    }, 0)
    const finish = setTimeout(onComplete, 500)
    return () => {
      clearTimeout(fill)
      clearTimeout(finish)
    }
  }, [ready, onComplete])

  return { progress, label }
}
