import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Download, Library, KeyRound, Settings } from 'lucide-react'

const navItems = [
  { path: '/install', label: 'Install', icon: Download },
  { path: '/library', label: 'Library', icon: Library },
  { path: '/dumper', label: 'Dumper', icon: KeyRound },
  { path: '/settings', label: 'Settings', icon: Settings },
]

function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="w-52 bg-bg-secondary border-r border-border flex flex-col shrink-0">
      <div className="flex flex-col gap-0.5 p-2 pt-3 flex-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
          const Icon = item.icon

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="relative flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors duration-100 cursor-pointer"
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-bg-tertiary rounded-md"
                  transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
                />
              )}
              <Icon
                size={16}
                className={`relative z-10 transition-colors duration-100 ${isActive ? 'text-text-primary' : 'text-text-muted'}`}
              />
              <span
                className={`relative z-10 transition-colors duration-100 ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default Sidebar
