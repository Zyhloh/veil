import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import InstallPage from './pages/InstallPage'
import LibraryPage from './pages/LibraryPage'
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
            <Route path="/library" element={<LibraryPage />} />
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
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.6)' }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="veil-card rounded-2xl p-6 max-w-sm w-full mx-4 relative"
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
