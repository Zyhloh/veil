import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LibraryProvider } from './lib/LibraryProvider'
import { InstallerProvider } from './lib/InstallerProvider'
import Splash from './components/Splash'
import MainShell from './components/MainShell'

function App() {
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [])

  if (getCurrentWindow().label === 'splash') {
    return <Splash />
  }

  return (
    <LibraryProvider>
      <InstallerProvider>
        <MainShell />
      </InstallerProvider>
    </LibraryProvider>
  )
}

export default App
