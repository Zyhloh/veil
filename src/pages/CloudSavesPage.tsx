import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { CircleNotch, FolderOpen, Warning, CloudArrowUp, Archive, UploadSimple } from '@phosphor-icons/react'
import { useLibrary } from '../lib/library-context'
import { useInstaller } from '../lib/installer-context'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  cloudSavesEnable,
  cloudSavesDisable,
  cloudSavesSetFolder,
  cloudSavesSetLogging,
  cloudSavesBackup,
  cloudSavesImport,
} from '../lib/cloudsave'

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-emerald-500/80' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200 ${
          on ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  )
}

function HeaderButton({
  onClick,
  disabled,
  busy,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 text-[12px] font-semibold text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200 active:scale-95 disabled:opacity-40"
    >
      {busy ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export default function CloudSavesPage() {
  const { steamPath } = useLibrary()
  const { notify, setRestartRequired, cloudStatus, setCloudStatus, refreshCloud } = useInstaller()
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [confirmEnable, setConfirmEnable] = useState(false)

  useEffect(() => {
    if (!cloudStatus) refreshCloud()
  }, [cloudStatus, refreshCloud])

  const doEnable = useCallback(async () => {
    if (!steamPath || !cloudStatus || busy) return
    setBusy(true)
    try {
      const next = await cloudSavesEnable(steamPath, cloudStatus.sync_path)
      setCloudStatus(next)
      notify('success', 'Cloud Saves enabled')
      if (next.steam_running) setRestartRequired(true)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [steamPath, cloudStatus, busy, notify, setRestartRequired, setCloudStatus])

  const disable = useCallback(async () => {
    if (!steamPath || !cloudStatus || busy) return
    setBusy(true)
    try {
      const next = await cloudSavesDisable(steamPath)
      setCloudStatus(next)
      notify('success', 'Cloud Saves disabled')
      if (next.steam_running) setRestartRequired(true)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [steamPath, cloudStatus, busy, notify, setRestartRequired, setCloudStatus])

  const toggle = useCallback(() => {
    if (!cloudStatus || busy) return
    if (cloudStatus.enabled) disable()
    else setConfirmEnable(true)
  }, [cloudStatus, busy, disable])

  const changeFolder = useCallback(async () => {
    if (!steamPath || !cloudStatus) return
    const dir = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: cloudStatus.sync_path || undefined,
    })
    if (typeof dir !== 'string') return
    try {
      const next = await cloudSavesSetFolder(steamPath, dir)
      setCloudStatus(next)
      notify('success', 'Cloud saves folder updated')
      if (cloudStatus.enabled && next.steam_running) setRestartRequired(true)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    }
  }, [steamPath, cloudStatus, notify, setRestartRequired, setCloudStatus])

  const toggleLog = useCallback(async () => {
    if (!steamPath || !cloudStatus) return
    try {
      const next = await cloudSavesSetLogging(steamPath, !cloudStatus.log_enabled)
      setCloudStatus(next)
      notify('success', next.log_enabled ? 'Debug log enabled' : 'Debug log disabled')
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    }
  }, [steamPath, cloudStatus, notify, setCloudStatus])

  const backup = useCallback(async () => {
    if (!steamPath || backupBusy) return
    setBackupBusy(true)
    try {
      await cloudSavesBackup(steamPath)
      notify('success', 'Backup saved to your Desktop')
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }, [steamPath, backupBusy, notify])

  const importSaves = useCallback(async () => {
    if (!steamPath || importBusy) return
    const zip = await openDialog({
      multiple: false,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    })
    if (typeof zip !== 'string') return
    setImportBusy(true)
    try {
      const count = await cloudSavesImport(steamPath, zip)
      notify('success', `Imported ${count} save file${count !== 1 ? 's' : ''}`)
      if (cloudStatus?.enabled && cloudStatus.steam_running) setRestartRequired(true)
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e))
    } finally {
      setImportBusy(false)
    }
  }, [steamPath, importBusy, cloudStatus, notify, setRestartRequired])

  const enabled = !!cloudStatus?.enabled
  const folder = cloudStatus?.sync_path || ''
  const ready = !!cloudStatus && !!steamPath

  return (
    <div className="flex h-full flex-col px-10 py-8">
      <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-neutral-100">Cloud Saves</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Redirect Steam Cloud saves for your Veil games to a local folder — owned Steam games are untouched.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <HeaderButton onClick={backup} disabled={!ready} busy={backupBusy} icon={<Archive size={14} weight="bold" />}>
            Back up
          </HeaderButton>
          <HeaderButton onClick={importSaves} disabled={!ready} busy={importBusy} icon={<UploadSimple size={14} weight="bold" />}>
            Import
          </HeaderButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-neutral-300">
            <CloudArrowUp size={22} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-neutral-100">Enable Cloud Saves</p>
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
              {busy
                ? 'Applying…'
                : 'Store and load saves from your folder instead of Steam Cloud. Applied automatically on startup.'}
            </p>
          </div>
          {busy ? (
            <CircleNotch size={18} className="animate-spin text-neutral-500" />
          ) : (
            <Toggle on={enabled} onClick={toggle} disabled={!cloudStatus} />
          )}
        </div>

        <div className="mx-4 border-t border-white/[0.05]" />

        <div className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-neutral-200">Saves folder</p>
            <p className={`mt-1 truncate font-mono text-[11.5px] ${folder ? 'text-neutral-500' : 'text-neutral-600'}`}>
              {folder || 'Not set'}
            </p>
          </div>
          <button
            onClick={changeFolder}
            disabled={!cloudStatus}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[12px] font-semibold text-neutral-300 transition hover:bg-white/[0.05] active:scale-95 disabled:opacity-40"
          >
            <FolderOpen size={14} weight="bold" />
            Change
          </button>
        </div>

        <div className="mx-4 border-t border-white/[0.05]" />

        <div className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-neutral-200">Write debug log</p>
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
              Writes cloud_redirect.log to your Steam folder. Off by default; turn on only when troubleshooting.
            </p>
          </div>
          <Toggle on={!!cloudStatus?.log_enabled} onClick={toggleLog} disabled={!cloudStatus} />
        </div>
      </div>

      {!steamPath && (
        <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-neutral-600">
          <Warning size={13} /> Steam installation not detected — set the path in Settings.
        </p>
      )}

      <p className="mt-4 max-w-[680px] text-[11.5px] leading-relaxed text-neutral-600">
        Saves appear to sync exactly like Steam Cloud, but the data is read and written to your local folder. Back up
        anything you care about before enabling, and treat the folder like Steam Cloud itself — don't manually edit a
        game's files inside it.
      </p>

      {confirmEnable && (
        <ConfirmDialog
          title="Enable Cloud Saves?"
          message="Steam occasionally detects the cloud-save patch and restarts itself. This is expected and harmless — Steam keeps working normally, it'll just relaunch on its own once in a while."
          confirmLabel="Enable"
          icon={<CloudArrowUp size={20} weight="bold" />}
          onConfirm={() => {
            setConfirmEnable(false)
            doEnable()
          }}
          onCancel={() => setConfirmEnable(false)}
        />
      )}
    </div>
  )
}
