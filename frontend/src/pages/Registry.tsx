import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import {
  ShieldCheck, ShieldOff, Clock, RefreshCw, AlertCircle,
  ExternalLink, CheckCircle2, Loader,
} from 'lucide-react'
import { ADDRESSES, SYBIL_REGISTRY_ABI } from '../contracts'
import { somniaTestnet } from '../chain'
import { useTxToasts } from '../components/Toast'

const EXPLORER = somniaTestnet.blockExplorers.default.url
const lsKey = (addr: string) => `vera_attest_pending_${addr.toLowerCase()}`

export default function Registry() {
  const { address, isConnected } = useAccount()

  // ── Pending-request persistence (survives page refresh) ─────────────────
  const [pendingRequestTime, setPendingRequestTime] = useState(0)

  useEffect(() => {
    if (!address) return
    const stored = localStorage.getItem(lsKey(address))
    setPendingRequestTime(stored ? Number(stored) : 0)
  }, [address])

  const isPendingAI = pendingRequestTime > 0

  // ── Attestation read — auto-polls every 10 s while waiting ──────────────
  const { data: att } = useReadContract({
    address: ADDRESSES.SybilRegistry,
    abi: SYBIL_REGISTRY_ABI,
    functionName: 'attestations',
    args: [address!],
    query: {
      enabled: !!address,
      refetchInterval: isPendingAI ? 10_000 : false,
    },
  })

  // viem may return named OR positional — handle both
  // attestations: [0]=score [1]=timestamp [2]=expiresAt [3]=exists
  const a         = att as any
  const gp        = (name: string, idx: number) => a?.[name] !== undefined ? a[name] : a?.[idx]
  const score     = a ? Number(gp('score',     0)) : 0
  const timestamp = a ? Number(gp('timestamp', 1)) : 0
  const expiresAt = a ? Number(gp('expiresAt', 2)) : 0
  const exists    = a ? Boolean(gp('exists',   3)) : false
  const nowSec    = Math.floor(Date.now() / 1000)
  const isExpired = exists && nowSec > expiresAt
  const isValid   = exists && !isExpired
  const daysLeft  = isValid ? Math.floor((expiresAt - nowSec) / 86400) : 0

  // ── Detect when AI callback arrives ─────────────────────────────────────
  const [justVerified, setJustVerified] = useState(false)

  useEffect(() => {
    if (!isPendingAI || !exists) return
    if (timestamp >= pendingRequestTime) {
      setPendingRequestTime(0)
      setJustVerified(true)
      if (address) localStorage.removeItem(lsKey(address))
      const t = setTimeout(() => setJustVerified(false), 6000)
      return () => clearTimeout(t)
    }
  }, [att, isPendingAI, exists, timestamp, pendingRequestTime, address])

  // ── Request attestation flow ─────────────────────────────────────────────
  const { writeContract, isPending, data: hash, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash })
  useTxToasts({ label: 'Score request', pending: isPending, confirming: isConfirming, success: txSuccess, error, hash })

  useEffect(() => {
    if (!txSuccess || !address) return
    const t = Math.floor(Date.now() / 1000)
    setPendingRequestTime(t)
    localStorage.setItem(lsKey(address), String(t))
    reset()
  }, [txSuccess, address, reset])

  const handleRequest = () => {
    if (!address) return
    writeContract({
      address: ADDRESSES.SybilRegistry,
      abi: SYBIL_REGISTRY_ABI,
      functionName: 'requestAttestation',
      args: [address],
      value: parseEther('0.40'),
    })
  }

  const busy = isPending || isConfirming

  // ── Not connected ────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <ShieldOff size={40} className="text-zinc-600" />
        <p className="text-zinc-400">Connect your wallet to check your Sybil score</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <p className="eyebrow mb-1">Wallet verification</p>
        <h1 className="display text-2xl font-bold text-zinc-50 tracking-tightest">Sybil Registry</h1>
        <p className="text-sm text-zinc-400 mt-1">
          AI-verified uniqueness score required to participate in IDO pools
        </p>
      </div>

      {/* Success banner */}
      {justVerified && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-300">Attestation received!</p>
            <p className="text-xs text-emerald-400/60 mt-0.5">Your Sybil score has been stored on-chain</p>
          </div>
        </div>
      )}

      {/* Score card */}
      <div className="card p-8">
        <div className="flex flex-col sm:flex-row gap-8 items-center">

          {/* Gauge */}
          <div className="shrink-0">
            {isPendingAI ? (
              <div className="w-[140px] h-[140px] rounded-full border-4 border-zinc-800 flex flex-col items-center justify-center gap-2">
                <Loader size={24} className="text-indigo-400 animate-spin" />
                <span className="text-xs text-zinc-500">AI scoring…</span>
              </div>
            ) : isValid ? (
              <ScoreGauge score={score} />
            ) : (
              <div className="w-[140px] h-[140px] rounded-full border-4 border-zinc-800 flex items-center justify-center">
                <ShieldOff size={32} className="text-zinc-600" />
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex-1 space-y-4 text-center sm:text-left">
            {isPendingAI ? (
              <AIPipelineStatus />
            ) : isValid ? (
              <>
                <div>
                  <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">Status</p>
                  <span className="badge-verified inline-flex items-center gap-1">
                    <ShieldCheck size={11} /> Verified
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Stat label="Score"      value={`${score} / 100`} />
                  <Stat label="Issued"     value={new Date(timestamp * 1000).toLocaleDateString()} />
                  <Stat label="Expires in" value={`${daysLeft} days`} />
                  <Stat label="Expires on" value={new Date(expiresAt * 1000).toLocaleDateString()} />
                </div>
                <p className="text-xs text-zinc-500">
                  {score >= 70 ? 'Strong score — eligible for most IDO pools'
                    : score >= 50 ? 'Good score — eligible for most pools'
                    : score >= 30 ? 'Low score — may be blocked from high-threshold pools'
                    : 'Very low score — likely blocked from participation'}
                </p>
              </>
            ) : isExpired ? (
              <>
                <span className="badge-ended inline-flex items-center gap-1">
                  <Clock size={11} /> Expired
                </span>
                <p className="text-sm text-zinc-400">Your attestation expired. Request a new one.</p>
              </>
            ) : (
              <>
                <span className="badge-ended inline-flex items-center gap-1">
                  <ShieldOff size={11} /> Not Verified
                </span>
                <p className="text-sm text-zinc-400">
                  No attestation found. Request one to get your Sybil score and participate in IDO pools.
                </p>
              </>
            )}

            <div className="pt-2 border-t border-zinc-800">
              <p className="text-xs text-zinc-500 mb-1">Wallet</p>
              <a
                href={`${EXPLORER}/address/${address}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-zinc-400 hover:text-zinc-200 font-mono flex items-center gap-1 transition-colors"
              >
                {address} <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Request / Refresh */}
      <div className="card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-zinc-100">
              {isValid ? 'Refresh Attestation' : isPendingAI ? 'Waiting for AI' : 'Request Attestation'}
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Costs 0.40 STT · the JSON API agent reads your tx count + STT balance (~2–4 min)
            </p>
          </div>
          <button
            className="btn-primary shrink-0 flex items-center gap-2"
            onClick={handleRequest}
            disabled={busy || isPendingAI}
          >
            {(busy || isPendingAI) && <RefreshCw size={13} className="animate-spin" />}
            {isPending    ? 'Confirm in wallet…'
              : isConfirming ? 'Submitting…'
              : isPendingAI  ? 'AI processing…'
              : isValid      ? 'Refresh Score'
              : 'Request Score'}
          </button>
        </div>

        {/* TX hash */}
        {hash && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500 mb-0.5">Transaction confirmed</p>
              <p className="text-xs font-mono text-zinc-300">{hash.slice(0, 22)}…</p>
            </div>
            <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors">
              <ExternalLink size={13} />
            </a>
          </div>
        )}

        {/* Live AI status */}
        {isPendingAI && <AIPipelineStatus expanded />}
      </div>

      {/* How scores work */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-zinc-100">How scores work</h2>
        <p className="text-xs text-zinc-500">
          The JSON API agent reads two on-chain signals and the score is derived
          transparently on-chain. Each contributes up to 50 points:
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
            <p className="text-xs font-medium text-zinc-300">Activity · up to 50</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
              Transaction count. 100+ tx = 50, 20–99 = 40, 5–19 = 30, 1–4 = 15.
            </p>
          </div>
          <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
            <p className="text-xs font-medium text-zinc-300">Capital · up to 50</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
              STT balance held. 100+ = 50, 20–99 = 45, 5–19 = 35, 1–4 = 20.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 bg-zinc-950 rounded-lg p-3 border border-zinc-800">
          <AlertCircle size={13} className="text-zinc-500 mt-0.5 shrink-0" />
          <p className="text-xs text-zinc-500">
            Combining activity <span className="text-zinc-400">and</span> real capital makes the
            score hard to farm — a bot army would need both many transactions and real STT in
            every wallet. Valid 90 days, reusable across all pools. The 0.4 STT fee covers two
            JSON API agent calls.
          </p>
        </div>
      </div>

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AIPipelineStatus({ expanded }: { expanded?: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div className={expanded ? 'bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 space-y-3' : 'space-y-1'}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
        <p className="text-sm font-medium text-amber-300">AI pipeline running</p>
        <span className="text-xs text-zinc-500 ml-auto">{elapsedStr}</span>
      </div>
      {expanded && (
        <div className="space-y-2 ml-4">
          <PipelineStep label="JSON API Agent" sub="Reading your wallet's transaction count from the block explorer API" />
          <PipelineStep label="On-chain scoring" sub="Deriving your 0–100 activity score and storing the attestation" pending />
          <p className="text-xs text-zinc-500 pt-1">
            Polling every 10 s · This page will update automatically when the score arrives · You can safely navigate away
          </p>
        </div>
      )}
    </div>
  )
}

function PipelineStep({ label, sub, pending }: { label: string; sub: string; pending?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {pending
        ? <Loader size={12} className="text-zinc-600 mt-0.5 shrink-0" />
        : <div className="w-3 h-3 rounded-full border border-amber-500/40 mt-0.5 shrink-0" />}
      <div>
        <p className="text-xs font-medium text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-500">{sub}</p>
      </div>
    </div>
  )
}

function ScoreGauge({ score }: { score: number }) {
  const r    = 54
  const circ = 2 * Math.PI * r
  const arc  = (score / 100) * circ
  const color = score >= 60 ? '#818cf8' : score >= 40 ? '#f59e0b' : '#f87171'
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#27272a" strokeWidth="8" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 70 70)"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x="70" y="63" textAnchor="middle" fill="#fafafa" fontSize="30" fontWeight="700" fontFamily="Inter">{score}</text>
      <text x="70" y="81" textAnchor="middle" fill="#71717a" fontSize="13" fontFamily="Inter">/100</text>
    </svg>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-medium text-zinc-100 mt-0.5">{value}</p>
    </div>
  )
}
