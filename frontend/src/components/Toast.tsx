import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { CheckCircle2, XCircle, Loader, ExternalLink, X } from 'lucide-react'
import { somniaTestnet } from '../chain'

const EXPLORER = somniaTestnet.blockExplorers.default.url

type ToastType = 'pending' | 'success' | 'error' | 'info'
type Toast = { id: number; type: ToastType; title: string; message?: string; href?: string }

type Ctx = {
  toast: (t: Omit<Toast, 'id'>) => number
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: number) => void
}

const ToastCtx = createContext<Ctx | null>(null)
export const useToast = () => {
  const c = useContext(ToastCtx)
  if (!c) throw new Error('useToast outside provider')
  return c
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const idRef = useRef(0)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: number) => {
    setItems(xs => xs.filter(x => x.id !== id))
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id] }
  }, [])

  const arm = useCallback((id: number, type: ToastType) => {
    if (timers.current[id]) clearTimeout(timers.current[id])
    if (type !== 'pending') {
      timers.current[id] = setTimeout(() => dismiss(id), type === 'error' ? 7000 : 5000)
    }
  }, [dismiss])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++idRef.current
    setItems(xs => [...xs, { ...t, id }])
    arm(id, t.type)
    return id
  }, [arm])

  const update = useCallback((id: number, patch: Partial<Omit<Toast, 'id'>>) => {
    setItems(xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x)))
    if (patch.type) arm(id, patch.type)
  }, [arm])

  return (
    <ToastCtx.Provider value={{ toast, update, dismiss }}>
      {children}
      <div className="fixed z-[60] top-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-80 flex flex-col gap-2 pointer-events-none">
        {items.map(t => <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </ToastCtx.Provider>
  )
}

/** Drop into any flow that exposes wagmi write/receipt state; fires lifecycle toasts. */
export function useTxToasts(opts: {
  label: string
  pending?: boolean      // wallet confirmation (isPending)
  confirming?: boolean   // mining (waitForReceipt isLoading)
  success?: boolean
  error?: unknown
  hash?: `0x${string}`
}) {
  const { toast, update } = useToast()
  const id = useRef<number | null>(null)
  const { label, pending, confirming, success, error, hash } = opts

  useEffect(() => {
    if (pending && id.current == null) id.current = toast({ type: 'pending', title: `${label}…`, message: 'Confirm in your wallet' })
  }, [pending, label, toast])

  useEffect(() => {
    if (confirming && id.current != null) update(id.current, { type: 'pending', title: `${label}…`, message: 'Submitting on-chain' })
  }, [confirming, label, update])

  useEffect(() => {
    if (success && id.current != null) {
      update(id.current, { type: 'success', title: `${label} confirmed`, message: undefined, href: hash ? `${EXPLORER}/tx/${hash}` : undefined })
      id.current = null
    }
  }, [success, label, hash, update])

  useEffect(() => {
    if (error) {
      if (id.current != null) { update(id.current, { type: 'error', title: `${label} failed`, message: undefined }); id.current = null }
      else toast({ type: 'error', title: `${label} failed` })
    }
  }, [error, label, toast, update])
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const ring =
    t.type === 'success' ? 'border-emerald-500/30' :
    t.type === 'error'   ? 'border-red-500/30' :
    t.type === 'pending' ? 'border-indigo-500/30' : 'border-zinc-700'
  const icon =
    t.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-400" /> :
    t.type === 'error'   ? <XCircle size={16} className="text-red-400" /> :
    t.type === 'pending' ? <Loader size={16} className="text-indigo-400 animate-spin" /> :
    <CheckCircle2 size={16} className="text-zinc-400" />

  return (
    <div className={`pointer-events-auto card !bg-zinc-900/95 border ${ring} p-3.5 shadow-2xl shadow-black/50 flex items-start gap-3`}
      style={{ animation: 'slideUp .2s ease both' }}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">{t.title}</p>
        {t.message && <p className="text-xs text-zinc-400 mt-0.5">{t.message}</p>}
        {t.href && (
          <a href={t.href} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mt-1">
            View transaction <ExternalLink size={10} />
          </a>
        )}
      </div>
      <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 shrink-0"><X size={14} /></button>
    </div>
  )
}
