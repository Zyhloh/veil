import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined
    win.isMaximized().then(setMaximized).catch(() => {})
    win
      .onResized(() => win.isMaximized().then(setMaximized).catch(() => {}))
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [])

  return maximized
}
