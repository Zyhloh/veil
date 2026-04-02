import { useLocation, useNavigate } from 'react-router-dom'
import { Download, Library, Settings } from 'lucide-react'

const navItems = [
  { path: '/install', label: 'Install', icon: Download },
  { path: '/library', label: 'Library', icon: Library },
]

const bottomItems = [
  { path: '/settings', label: 'Settings', icon: Settings },
]

function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const renderItem = (item: typeof navItems[0]) => {
    const isActive = location.pathname === item.path
    const Icon = item.icon

    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        className={`relative flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[13px] font-medium tracking-[-0.01em] ${
          isActive ? 'veil-nav-active text-white' : 'veil-nav-item text-white/60 hover:text-white'
        }`}
      >
        <Icon
          size={16}
          strokeWidth={isActive ? 2 : 1.5}
        />
        <span>
          {item.label}
        </span>
      </button>
    )
  }

  return (
    <aside className="veil-sidebar w-[240px] flex flex-col shrink-0 antialiased">
      <nav className="mt-2 flex flex-col gap-1 px-3 flex-1">
        {navItems.map(renderItem)}
      </nav>

      <div className="mt-auto flex flex-col">
        <div className="veil-divider mx-3" />
        <div className="px-3 py-3">
          {bottomItems.map(renderItem)}
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
