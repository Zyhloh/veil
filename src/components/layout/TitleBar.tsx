import { useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Copy, X } from 'lucide-react'

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
      className="veil-titlebar flex items-center justify-between h-[36px] select-none shrink-0 relative z-50"
    >
      <div data-tauri-drag-region className="flex items-center gap-3 px-4 h-full">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-[13px] tracking-tight">Veil</span>
          <span className="text-white/20 text-[10px] font-medium">v1.0.4</span>
        </div>
      </div>

      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="h-full w-[46px] flex items-center justify-center hover:bg-[#1a1a1f] transition-colors duration-75 active:bg-[#222228]"
        >
          <Minus size={15} strokeWidth={1.5} className="text-white/30" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full w-[46px] flex items-center justify-center hover:bg-[#1a1a1f] transition-colors duration-75 active:bg-[#222228]"
        >
          <Copy size={12} strokeWidth={1.5} className="text-white/30" />
        </button>
        <button
          onClick={handleClose}
          className="h-full w-[46px] flex items-center justify-center hover:bg-[#c42b1c] transition-colors duration-75 group"
        >
          <X size={15} strokeWidth={1.5} className="text-white/30 group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
