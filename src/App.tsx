import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import InstallPage from './pages/InstallPage'
import CatalogPage from './pages/CatalogPage'
import LibraryPage from './pages/LibraryPage'
import DumperPage from './pages/DumperPage'
import PatcherPage from './pages/PatcherPage'
import SettingsPage from './pages/SettingsPage'
import { useAppInit } from './hooks/useAppInit'
import { UpdateProvider } from './hooks/useUpdate'

function AppInner() {
  const { showRestartModal, setShowRestartModal } = useAppInit()

  return (
    <div className="flex flex-col h-full w-full">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route path="/" element={<Navigate to="/install" replace />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/dumper" element={<DumperPage />} />
            <Route path="/patcher" element={<PatcherPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>

      <AnimatePresence>
        {showRestartModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              background: 'rgba(0,0,0,0.72)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 14 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.8 }}
              className="rounded-2xl p-6 max-w-sm w-full mx-4 relative"
              style={{
                background: '#0d0d10',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow:
                  'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 32px 80px -24px rgba(0,0,0,0.8)',
              }}
            >
              <button
                onClick={() => setShowRestartModal(false)}
                className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={16} />
              </button>
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="veil-icon-box w-12 h-12 rounded-xl flex items-center justify-center">
                  <AlertTriangle size={22} strokeWidth={1.5} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-[15px]">Restart Steam Required</p>
                  <p className="text-white/40 text-[12px] mt-2 leading-relaxed">
                    Veil has been installed. Please restart Steam manually for changes to take effect.
                  </p>
                </div>
                <button
                  onClick={() => setShowRestartModal(false)}
                  className="veil-btn-primary w-full py-2.5 rounded-xl text-[13px] font-semibold mt-1"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function App() {
  return (
    <UpdateProvider>
      <AppInner />
    </UpdateProvider>
  )
}

export default App
