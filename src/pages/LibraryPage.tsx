import { motion } from 'framer-motion'
import { Library } from 'lucide-react'

function LibraryPage() {
  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Library</h1>
        <p className="text-text-muted text-xs mt-1">
          View and manage your installed manifests
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex-1 flex flex-col items-center justify-center gap-3"
      >
        <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center">
          <Library size={22} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-text-secondary text-sm font-medium">No manifests installed</p>
          <p className="text-text-muted text-xs mt-1">
            Install some manifests to see them here
          </p>
        </div>
      </motion.div>
    </div>
  )
}

export default LibraryPage
