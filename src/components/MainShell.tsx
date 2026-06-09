import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import SteamControl from './SteamControl'
import Toast from './Toast'
import ProcessingModal from './ProcessingModal'
import DropResultModal from './DropResultModal'
import LibraryPage from '../pages/LibraryPage'
import CatalogPage from '../pages/CatalogPage'
import FixesPage from '../pages/FixesPage'
import ForzaFixPage from '../pages/ForzaFixPage'
import BypassesPage from '../pages/BypassesPage'
import DumperPage from '../pages/DumperPage'
import CloudSavesPage from '../pages/CloudSavesPage'
import SettingsPage from '../pages/SettingsPage'
import { useMaximized } from '../lib/useMaximized'
import { useInstaller } from '../lib/installer-context'
import {
  SquaresFour,
  Compass,
  Wrench,
  ShieldSlash,
  Database,
  CloudArrowUp,
  GearSix,
  Tray,
  Minus,
  Square,
  Copy,
  X,
} from '@phosphor-icons/react'

type IconType = ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; className?: string }>

interface NavItem {
  id: string
  Icon: IconType
  desc: string
}

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Workspace',
    items: [
      { id: 'Library', Icon: SquaresFour, desc: 'Your installed manifests and games.' },
      { id: 'Catalog', Icon: Compass, desc: 'Browse and add new manifests.' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'Fixes', Icon: Wrench, desc: 'Patches and game-specific fixes.' },
      { id: 'Bypasses', Icon: ShieldSlash, desc: 'Manage protection bypasses.' },
      { id: 'Dumper', Icon: Database, desc: 'Dump manifests from your library.' },
      { id: 'Cloud Saves', Icon: CloudArrowUp, desc: 'Redirect cloud saves to a local folder.' },
    ],
  },
]

const FIX_PAGES = ['ForzaFix']

const flatItems = [...sections.flatMap((s) => s.items)]

const settings: NavItem = { id: 'Settings', Icon: GearSix, desc: 'Configure Veil.' }

function NavButton({
  item,
  active,
  onSelect,
  badge,
}: {
  item: NavItem
  active: boolean
  onSelect: (id: string) => void
  badge?: boolean
}) {
  const { Icon } = item
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold leading-none transition-colors duration-150 ${
        active
          ? 'bg-white/[0.06] text-neutral-100 ring-1 ring-inset ring-white/[0.05]'
          : 'text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200'
      }`}
    >
      <Icon size={18} weight="regular" className={active ? 'opacity-100' : 'opacity-70'} />
      {item.id}
      {badge && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
    </button>
  )
}

function WindowButton({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors ${
        danger ? 'hover:bg-white/[0.08] hover:text-neutral-100' : 'hover:bg-white/[0.06] hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}

export default function MainShell() {
  const win = getCurrentWindow()
  const [active, setActive] = useState('Library')
  const [dragOver, setDragOver] = useState(false)
  const [version, setVersion] = useState('')
  const maximized = useMaximized()
  const { importFiles, importText, processing, dropResult, clearDropResult, restartRequired, updateInfo } =
    useInstaller()
  const dragDepth = useRef(0)

  useEffect(() => {
    invoke<string>('app_version').then(setVersion).catch(() => {})
  }, [])

  const toggleMaximize = () => {
    win.toggleMaximize()
  }

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current += 1
      setDragOver(true)
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current -= 1
      if (dragDepth.current <= 0) {
        dragDepth.current = 0
        setDragOver(false)
      }
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const dt = e.dataTransfer
      if (!dt) return

      const files = dt.files ? Array.from(dt.files) : []
      const manifestFiles = files.filter((f) => /\.(zip|lua|manifest)$/i.test(f.name))
      const text = (dt.getData('text/uri-list') || dt.getData('text/plain') || dt.getData('text') || '').trim()

      if (manifestFiles.length > 0) {
        importFiles(manifestFiles)
      } else if (text && /\d{3,}/.test(text)) {
        importText(text)
      } else if (files.length > 0) {
        importFiles(files)
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles, importText])

  const current = [...flatItems, settings].find((i) => i.id === active) ?? flatItems[0]

  return (
    <motion.div
      className={`fixed inset-0 flex flex-col overflow-hidden border border-white/[0.06] bg-[#0a0a0a] ${
        maximized ? 'rounded-none' : 'rounded-[10px]'
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.2 }}
    >
      <header
        data-tauri-drag-region
        className="relative flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] pl-4 pr-2"
      >
        <img src="/veil.png" alt="Veil" className="pointer-events-none h-6 w-6 object-contain" />
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2 select-none">
          <span className="text-[13px] font-extrabold tracking-[0.3em] text-neutral-200">VEIL</span>
          {version && (
            <span className="text-[10px] font-bold tracking-[0.1em] text-neutral-600">V{version}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <WindowButton onClick={() => win.minimize()}>
            <Minus size={16} weight="bold" />
          </WindowButton>
          <WindowButton onClick={toggleMaximize}>
            {maximized ? <Copy size={14} weight="regular" /> : <Square size={14} weight="regular" />}
          </WindowButton>
          <WindowButton onClick={() => win.close()} danger>
            <X size={16} weight="bold" />
          </WindowButton>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-56 shrink-0 flex-col border-r border-white/[0.06] px-3 py-4">
          {sections.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-600">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={active === item.id || (item.id === 'Fixes' && FIX_PAGES.includes(active))}
                    onSelect={setActive}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-0.5">
            <AnimatePresence>
              {restartRequired && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden px-3 pb-2 text-center text-[11px] font-semibold text-amber-400/90"
                >
                  Steam Restart Required
                </motion.p>
              )}
            </AnimatePresence>
            <div className="mb-2 border-t border-white/[0.06]" />
            <SteamControl />
            <NavButton
              item={settings}
              active={active === settings.id}
              onSelect={setActive}
              badge={!!updateInfo?.available}
            />
          </div>
        </nav>

        <main className="flex-1 overflow-hidden">
          {active === 'Library' ? (
            <LibraryPage />
          ) : active === 'Catalog' ? (
            <CatalogPage onNavigate={setActive} />
          ) : active === 'Fixes' ? (
            <FixesPage onNavigate={setActive} />
          ) : active === 'ForzaFix' ? (
            <ForzaFixPage onBack={() => setActive('Fixes')} />
          ) : active === 'Bypasses' ? (
            <BypassesPage />
          ) : active === 'Dumper' ? (
            <DumperPage />
          ) : active === 'Cloud Saves' ? (
            <CloudSavesPage />
          ) : active === 'Settings' ? (
            <SettingsPage />
          ) : (
            <div className="h-full overflow-y-auto px-10 py-8">
              <h2 className="text-2xl font-bold text-neutral-100">{current.id}</h2>
              <p className="mt-1 text-sm text-neutral-500">{current.desc}</p>
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-0 z-[150] flex items-center justify-center bg-[#0a0a0a]/80 backdrop-blur-[1px]"
          >
            <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.03] px-16 py-12">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-neutral-300">
                <Tray size={28} weight="regular" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-bold text-neutral-200">Drop to install</p>
                <p className="mt-1 text-[12px] text-neutral-500">.zip, .lua, .manifest, or SteamDB links</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{processing && <ProcessingModal label={processing.label} />}</AnimatePresence>
      <AnimatePresence>
        {dropResult && <DropResultModal result={dropResult} onClose={clearDropResult} />}
      </AnimatePresence>

      <Toast />
    </motion.div>
  )
}
