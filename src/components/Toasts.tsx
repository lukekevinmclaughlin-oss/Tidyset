import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'
import { useStore, Toast } from '../state/store'

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast)
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), 3800)
    return () => clearTimeout(id)
  }, [toast.id, dismiss])

  const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertTriangle : Info
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={'toast glass ' + toast.kind}
    >
      <Icon size={16} className="ticon" />
      <span className="tmsg">{toast.msg}</span>
      <button className="tclose" onClick={() => dismiss(toast.id)}>
        <X size={13} />
      </button>
    </motion.div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toast-wrap">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
      <style>{css}</style>
    </div>
  )
}

const css = `
.toast-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 9px; align-items: flex-end; }
.toast { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 13px; min-width: 240px; max-width: 380px; }
.toast .ticon { flex-shrink: 0; }
.toast.success .ticon { color: var(--good); }
.toast.error .ticon { color: var(--danger); }
.toast.info .ticon { color: var(--accent); }
.tmsg { font-size: 12.5px; font-weight: 520; flex: 1; color: var(--text-1); }
.tclose { border: none; background: transparent; color: var(--text-3); cursor: default; padding: 2px; border-radius: 5px; display: grid; place-items: center; }
.tclose:hover { background: var(--hover); color: var(--text-1); }
`
