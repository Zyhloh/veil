import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileArchive, CheckCircle, AlertCircle } from 'lucide-react'

function InstallPage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setStatus('processing')
    setTimeout(() => setStatus('idle'), 2000)
  }, [])

  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Install Manifests</h1>
        <p className="text-text-muted text-xs mt-1">
          Drop folders, ZIP archives, or individual manifest files
        </p>
      </div>

      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        animate={{
          borderColor: isDragOver ? 'var(--color-text-primary)' : 'var(--color-border)',
          backgroundColor: isDragOver ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
        }}
        className="flex-1 min-h-[300px] border border-dashed rounded-lg flex flex-col items-center justify-center gap-4 cursor-pointer"
      >
        <AnimatePresence mode="wait">
          {status === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center">
                <Upload size={22} className="text-text-muted" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm font-medium">Drag & drop files here</p>
                <p className="text-text-muted text-xs mt-1">
                  .manifest, .lua, .vdf, or ZIP archives
                </p>
              </div>
            </motion.div>
          )}

          {status === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center">
                <FileArchive size={22} className="text-text-secondary animate-pulse" />
              </div>
              <p className="text-text-muted text-sm">Processing files...</p>
            </motion.div>
          )}

          {status === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-3"
            >
              <CheckCircle size={32} className="text-success" />
              <p className="text-success text-sm">Manifests installed successfully</p>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-3"
            >
              <AlertCircle size={32} className="text-danger" />
              <p className="text-danger text-sm">Failed to install manifests</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

export default InstallPage
