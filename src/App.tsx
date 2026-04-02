import { Routes, Route, Navigate } from 'react-router-dom'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import InstallPage from './pages/InstallPage'
import LibraryPage from './pages/LibraryPage'
import DumperPage from './pages/DumperPage'
import SettingsPage from './pages/SettingsPage'

function App() {
  return (
    <div className="flex flex-col h-full w-full">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/install" replace />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/dumper" element={<DumperPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default App
