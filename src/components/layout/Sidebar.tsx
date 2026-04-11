import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Download, Library, KeyRound, Settings, Power, RotateCw, Loader2, LayoutGrid, Wrench } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useUpdate } from '../../hooks/useUpdate'

const navItems = [
  { path: '/install', label: 'Install', icon: Download },
  { path: '/catalog', label: 'Catalog', icon: LayoutGrid },
  { path: '/library', label: 'Library', icon: Library },
  { path: '/dumper', label: 'Dumper', icon: KeyRound },
  { path: '/patcher', label: 'Patcher', icon: Wrench },
]

const bottomItems = [
  { path: '/settings', label: 'Settings', icon: Settings },
]

function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { info } = useUpdate()
  const updateAvailable = !!info?.available

  const [steamRunning, setSteamRunning] = useState<boolean | null>(null)
  const [steamBusy, setSteamBusy] = useState(false)
  const lastClickRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const running = await invoke<boolean>('check_steam_running')
        if (!cancelled) setSteamRunning(running)
      } catch {
        if (!cancelled) setSteamRunning(false)
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const handleSteamClick = async () => {
    if (steamBusy) return
    const now = Date.now()
    if (now - lastClickRef.current < 1200) return
    lastClickRef.current = now

    setSteamBusy(true)
    try {
      if (steamRunning) {
        await invoke('restart_steam')
      } else {
        await invoke('start_steam')
      }
      setTimeout(async () => {
        try {
          const running = await invoke<boolean>('check_steam_running')
          setSteamRunning(running)
        } catch {}
        setSteamBusy(false)
      }, 1500)
    } catch {
      setSteamBusy(false)
    }
  }

  const renderItem = (item: typeof navItems[0]) => {
    const isActive = location.pathname === item.path
    const Icon = item.icon
    const showDot = item.path === '/settings' && updateAvailable

    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        className={`relative flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[13px] font-medium tracking-[-0.01em] ${
          isActive ? 'veil-nav-active text-white' : 'veil-nav-item text-white/60 hover:text-white'
        }`}
      >
        <div className="relative">
          <Icon
            size={16}
            strokeWidth={isActive ? 2 : 1.5}
          />
          {showDot && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0a0a0a]" />
          )}
        </div>
        <span>
          {item.label}
        </span>
        {showDot && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
            Update
          </span>
        )}
      </button>
    )
  }

  const steamLabel = steamBusy
    ? steamRunning
      ? 'Restarting Steam'
      : 'Starting Steam'
    : steamRunning
      ? 'Restart Steam'
      : steamRunning === false
        ? 'Start Steam'
        : 'Steam'
  const SteamIcon = steamBusy ? Loader2 : steamRunning ? RotateCw : Power

  return (
    <aside className="veil-sidebar w-[240px] flex flex-col shrink-0 antialiased">
      <nav className="mt-2 flex flex-col gap-1 px-3 flex-1">
        {navItems.map(renderItem)}
      </nav>

      <div className="mt-auto flex flex-col">
        <div className="px-3 pb-2">
          <button
            onClick={handleSteamClick}
            disabled={steamBusy || steamRunning === null}
            className="veil-nav-item relative flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[13px] font-medium tracking-[-0.01em] text-white/60 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SteamIcon
              size={16}
              strokeWidth={1.5}
              className={steamBusy ? 'animate-spin' : ''}
            />
            <span>{steamLabel}</span>
          </button>
        </div>
        <div className="veil-divider mx-3" />
        <div className="px-3 py-3">
          {bottomItems.map(renderItem)}
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
