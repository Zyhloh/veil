import { motion } from 'framer-motion'
import { KeyRound } from 'lucide-react'

function DumperPage() {
  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Manifest Dumper</h1>
        <p className="text-text-muted text-xs mt-1">
          Login to Steam and export manifests from games you own
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex-1 flex flex-col items-center justify-center gap-3"
      >
        <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center">
          <KeyRound size={22} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-text-secondary text-sm font-medium">Steam login required</p>
          <p className="text-text-muted text-xs mt-1">
            Connect your Steam account to dump manifests
          </p>
        </div>
        <button className="mt-2 px-5 py-2 bg-white hover:bg-accent-hover text-bg-primary font-medium text-sm rounded-md transition-colors duration-100">
          Login to Steam
        </button>
      </motion.div>
    </div>
  )
}

export default DumperPage
