import { useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X } from 'lucide-react'

function TitleBar() {
  const handleMinimize = useCallback(async () => {
    const win = getCurrentWindow()
    await win.minimize()
  }, [])

  const handleMaximize = useCallback(async () => {
    const win = getCurrentWindow()
    await win.toggleMaximize()
  }, [])

  const handleClose = useCallback(async () => {
    const win = getCurrentWindow()
    await win.close()
  }, [])

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 bg-bg-secondary border-b border-border select-none shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 px-4 h-full">
        <span className="text-text-primary font-semibold text-xs tracking-widest uppercase">Veil</span>
        <span className="text-text-muted text-[10px] font-mono">1.0.0</span>
      </div>

      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="h-full w-11 flex items-center justify-center hover:bg-bg-hover transition-colors duration-100"
        >
          <Minus size={14} className="text-text-muted" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full w-11 flex items-center justify-center hover:bg-bg-hover transition-colors duration-100"
        >
          <Square size={11} className="text-text-muted" />
        </button>
        <button
          onClick={handleClose}
          className="h-full w-11 flex items-center justify-center hover:bg-danger transition-colors duration-100 group"
        >
          <X size={14} className="text-text-muted group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
