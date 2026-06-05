import { useState, useRef, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import {
  X, Zap, RefreshCw, Lock, Clock, ShieldCheck, Rocket,
  ChevronUp, CheckCircle2, ExternalLink, RotateCcw, Sparkles,
} from 'lucide-react'
import { ADDRESSES, LAUNCH_POOL_ABI, SYBIL_REGISTRY_ABI, ERC20_ABI, TRUST_ORACLE_ABI } from '../contracts'
import { usePools, useCountdown, poolStatus, type Pool } from '../hooks/usePools'
import { somniaTestnet } from '../chain'
import { Link } from 'react-router-dom'
import { TokenLogo, accentFor } from '../components/TokenLogo'

const EXPLORER = somniaTestnet.blockExplorers.default.url

export default function Discover() {
  const { pools, refetch } = usePools(15_000)
  const { isConnected } = useAccount()

  // Only pools a retail investor can act on: live or upcoming, not finalized/ended.
  const deck = pools
    .filter(p => { const s = poolStatus(p); return s === 'live' || s === 'upcoming' })
    .sort((a, b) => (poolStatus(a) === 'live' ? -1 : 1) - (poolStatus(b) === 'live' ? -1 : 1))

  const [idx, setIdx] = useState(0)
  const [investPool, setInvestPool] = useState<Pool | null>(null)
  const [seen, setSeen] = useState(0)

  // Reset index if the deck shrinks (e.g. a pool ends)
  useEffect(() => { if (idx > deck.length) setIdx(deck.length) }, [deck.length, idx])

  const advance = () => { setIdx(i => i + 1); setSeen(s => s + 1) }

  const onSwipe = (dir: 'left' | 'right', pool: Pool) => {
    if (dir === 'right') setInvestPool(pool)
    advance()
  }

  const remaining = deck.slice(idx)

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="eyebrow mb-1">For investors</p>
          <h1 className="display text-2xl font-bold text-zinc-50 tracking-tightest">Discover</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Swipe through live token launches</p>
        </div>
        <button onClick={() => refetch()} className="btn-ghost flex items-center gap-1.5 text-xs">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Deck */}
      <div className="relative h-[460px] select-none">
        {/* ambient glow tied to the top card */}
        {isConnected && remaining.length > 0 && (
          <div
            className="absolute -inset-6 rounded-[3rem] blur-3xl opacity-40 pointer-events-none transition-all duration-500"
            style={{ background: `radial-gradient(60% 50% at 50% 30%, ${accentFor(remaining[0].projectToken).glow}, transparent 70%)` }}
          />
        )}
        {!isConnected && (
          <Overlay icon={<Rocket size={30} className="text-zinc-600" />} title="Connect to start"
            sub="Connect your wallet to browse and back token launches" />
        )}

        {isConnected && remaining.length === 0 && (
          <Overlay
            icon={<CheckCircle2 size={30} className="text-emerald-400" />}
            title={seen > 0 ? "You're all caught up" : 'No live launches yet'}
            sub={seen > 0 ? 'Check back soon for new pools' : 'Be the first — create one on the Launchpad'}
            action={
              seen > 0
                ? <button onClick={() => { setIdx(0); setSeen(0) }} className="btn-secondary flex items-center gap-2"><RotateCcw size={13} /> Start over</button>
                : <Link to="/launchpad" className="btn-secondary">Go to Launchpad</Link>
            }
          />
        )}

        {isConnected && remaining.slice(0, 3).reverse().map((pool, ri) => {
          const stackIndex = remaining.slice(0, 3).length - 1 - ri // 0 = top
          return (
            <SwipeCard
              key={pool.id}
              pool={pool}
              isTop={stackIndex === 0}
              depth={stackIndex}
              onSwipe={dir => onSwipe(dir, pool)}
            />
          )
        })}
      </div>

      {/* Action bar */}
      {isConnected && remaining.length > 0 && (
        <div className="flex items-center justify-center gap-6 mt-6">
          <button
            onClick={() => advance()}
            className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:border-rose-500/40 transition-colors active:scale-95"
            aria-label="Skip"
          >
            <X size={22} />
          </button>
          <span className="text-xs text-zinc-600 font-mono w-10 text-center">
            {Math.min(idx + 1, deck.length)}/{deck.length}
          </span>
          <button
            onClick={() => setInvestPool(remaining[0])}
            className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white hover:bg-indigo-500 transition-colors active:scale-95 shadow-lg shadow-indigo-600/20"
            aria-label="Invest"
          >
            <Zap size={22} />
          </button>
        </div>
      )}

      {/* Hint */}
      {isConnected && remaining.length > 0 && (
        <p className="text-center text-xs text-zinc-600 mt-4">
          Swipe right or tap <Zap size={11} className="inline -mt-0.5 text-indigo-400" /> to back ·
          left or <X size={11} className="inline -mt-0.5" /> to skip
        </p>
      )}

      {investPool && (
        <InvestSheet
          pool={investPool}
          onClose={() => setInvestPool(null)}
          onDone={() => { setInvestPool(null); refetch() }}
        />
      )}
    </div>
  )
}

// ── Swipe card ──────────────────────────────────────────────────────────────────
function SwipeCard({ pool, isTop, depth, onSwipe }: {
  pool: Pool; isTop: boolean; depth: number; onSwipe: (dir: 'left' | 'right') => void
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0)
  const start = useRef({ x: 0, y: 0 })
  const accent = accentFor(pool.projectToken)
  const status = poolStatus(pool)
  const countdown = useCountdown(status === 'upcoming' ? pool.startTime : pool.endTime)

  const { data: sym } = useReadContract({
    address: pool.projectToken, abi: ERC20_ABI, functionName: 'symbol',
    query: { enabled: !!pool.projectToken },
  })
  const { data: name } = useReadContract({
    address: pool.projectToken, abi: ERC20_ABI, functionName: 'name',
    query: { enabled: !!pool.projectToken },
  })
  const { data: supply } = useReadContract({
    address: pool.projectToken, abi: ERC20_ABI, functionName: 'totalSupply',
    query: { enabled: !!pool.projectToken },
  })
  const { data: project } = useReadContract({
    address: ADDRESSES.TrustOracle, abi: TRUST_ORACLE_ABI, functionName: 'getProject',
    args: [BigInt(pool.id)], query: { refetchInterval: 15_000 },
  })
  const trustStatus = project ? Number((project as any).status ?? (project as any)[3]) : 0
  const trustScore  = project ? Number((project as any).score ?? (project as any)[2]) : 0
  const trustColor = trustScore >= 70 ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
    : trustScore >= 40 ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
    : 'text-rose-300 border-rose-500/30 bg-rose-500/10'

  const progress = pool.hardCap > 0n ? Number((pool.totalRaised * 100n) / pool.hardCap) : 0
  const symbol = (sym as string) ?? '···'
  // Fully-diluted valuation = price (STT/token) × total supply (tokens)
  const fdv = supply !== undefined ? (pool.tokenPrice * (supply as bigint)) / 10n ** 18n : null
  const vestDays = Number(pool.buyerVest) / 86400

  const THRESHOLD = 110

  const onDown = (e: React.PointerEvent) => {
    if (!isTop) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, y: e.clientY }
    setDragging(true)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setDrag({ x: e.clientX - start.current.x, y: (e.clientY - start.current.y) * 0.4 })
  }
  const onUp = () => {
    if (!dragging) return
    setDragging(false)
    if (drag.x > THRESHOLD)       { setLeaving(1);  setTimeout(() => onSwipe('right'), 180) }
    else if (drag.x < -THRESHOLD) { setLeaving(-1); setTimeout(() => onSwipe('left'),  180) }
    else setDrag({ x: 0, y: 0 })
  }

  const x = leaving ? leaving * 700 : drag.x
  const rot = x / 22
  const likeOpacity = Math.max(0, Math.min(1, drag.x / THRESHOLD))
  const nopeOpacity = Math.max(0, Math.min(1, -drag.x / THRESHOLD))

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0"
      style={{
        transform: `translate(${x}px, ${leaving ? -40 : drag.y}px) rotate(${rot}deg) scale(${1 - depth * 0.04})`,
        translate: `0 ${depth * 14}px`,
        transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(.2,.8,.2,1)',
        zIndex: 10 - depth,
        cursor: isTop ? 'grab' : 'default',
        touchAction: 'none',
        opacity: depth > 1 ? 0.6 : 1,
        pointerEvents: isTop ? 'auto' : 'none',
      }}
    >
      <div className={`h-full p-6 flex flex-col overflow-hidden rounded-2xl border border-zinc-800 ring-1 ${accent.ring} relative shadow-2xl shadow-black/50`}
        style={{ background: 'linear-gradient(180deg, #1a1a1f 0%, #131316 100%)' }}>
        {/* accent wash */}
        <div className={`absolute inset-x-0 top-0 h-44 bg-gradient-to-b ${accent.wash} to-transparent pointer-events-none opacity-70`} />

        {/* swipe labels */}
        <div className="absolute top-7 left-6 px-3 py-1 rounded-lg border-2 border-emerald-400 text-emerald-400 font-bold text-lg rotate-[-12deg] z-10"
          style={{ opacity: likeOpacity }}>BACK</div>
        <div className="absolute top-7 right-6 px-3 py-1 rounded-lg border-2 border-rose-400 text-rose-400 font-bold text-lg rotate-[12deg] z-10"
          style={{ opacity: nopeOpacity }}>SKIP</div>

        {/* Logo + status */}
        <div className="relative flex items-start justify-between">
          <div className="relative">
            <div className="absolute -inset-2 rounded-3xl blur-xl opacity-60" style={{ background: accent.glow }} />
            <div className="relative">
              <TokenLogo address={pool.projectToken} symbol={symbol} size={64} />
            </div>
          </div>
          {status === 'live'
            ? <span className="badge-live flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${accent.dot} animate-pulse`} />Live</span>
            : <span className="badge-upcoming">Upcoming</span>}
        </div>

        {/* Name */}
        <div className="relative mt-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-50 tracking-tight">{(name as string) ?? 'Token launch'}</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-0.5 flex items-center gap-1.5">
            <span className={`font-semibold ${accent.text}`}>{symbol}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">Pool #{pool.id}</span>
          </p>
          {/* AI Trust score — buyer-side signal */}
          <div className="mt-2">
            {trustStatus === 3 ? (
              <span className={`text-xs px-2 py-1 rounded-lg border inline-flex items-center gap-1.5 ${trustColor}`}>
                <Sparkles size={11} /> AI Trust {trustScore}/100
              </span>
            ) : trustStatus === 2 ? (
              <span className="text-xs px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-800/40 text-zinc-400 inline-flex items-center gap-1.5">
                <Sparkles size={11} className="animate-pulse" /> AI scoring trust…
              </span>
            ) : null}
          </div>
        </div>

        {/* Price highlight */}
        <div className="relative mt-5 bg-zinc-950/60 rounded-xl p-4 border border-zinc-800">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-zinc-500">Token price</p>
              <p className="text-2xl font-bold text-zinc-50 mt-0.5">
                {formatEther(pool.tokenPrice)} <span className="text-sm font-medium text-zinc-400">STT</span>
              </p>
            </div>
            {fdv !== null && (
              <div className="text-right">
                <p className="text-xs text-zinc-500">FDV</p>
                <p className="text-sm font-semibold text-zinc-200 mt-0.5">
                  {Number(formatEther(fdv)).toLocaleString(undefined, { maximumFractionDigits: 0 })} STT
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            1 STT ≈ {pool.tokenPrice > 0n ? Math.floor(1e18 / Number(pool.tokenPrice)).toLocaleString() : '∞'} {symbol}
          </p>
        </div>

        {/* Economics badges */}
        {(pool.usesTreasury || vestDays > 0) && (
          <div className="relative mt-3 flex flex-wrap gap-2">
            {pool.usesTreasury && (
              <span className="text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                <ShieldCheck size={11} /> Funds released by AI milestones
              </span>
            )}
            {vestDays > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 border border-sky-500/20 flex items-center gap-1">
                <Clock size={11} /> Tokens vest over {vestDays >= 1 ? `${Math.round(vestDays)}d` : `${Math.round(Number(pool.buyerVest) / 3600)}h`}
              </span>
            )}
          </div>
        )}

        {/* Progress */}
        <div className="relative mt-4 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-300">{formatEther(pool.totalRaised)} raised</span>
            <span className="text-zinc-500">{formatEther(pool.hardCap)} STT cap</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div className={`${accent.dot} h-2 rounded-full transition-all`} style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>

        {/* Footer stats */}
        <div className="relative mt-auto pt-4 grid grid-cols-2 gap-3 text-xs">
          <Stat icon={<Clock size={12} />} label={status === 'upcoming' ? 'Starts in' : 'Ends in'} value={countdown} />
          <Stat
            icon={pool.minSybilScore > 0 ? <Lock size={12} /> : <ShieldCheck size={12} />}
            label="Entry"
            value={pool.minSybilScore > 0 ? `Score ≥ ${pool.minSybilScore}` : 'Open to all'}
          />
        </div>
      </div>
    </div>
  )
}

// ── Invest sheet ─────────────────────────────────────────────────────────────────
function InvestSheet({ pool, onClose, onDone }: { pool: Pool; onClose: () => void; onDone: () => void }) {
  const { address } = useAccount()
  const accent = accentFor(pool.projectToken)
  const perWalletSTT = Number(formatEther(pool.perWalletCap))
  const { data: sym } = useReadContract({ address: pool.projectToken, abi: ERC20_ABI, functionName: 'symbol' })
  const symbol = (sym as string) ?? 'tokens'

  const presets = [0.5, 1, 2, 5].filter(v => v <= perWalletSTT)
  const [amount, setAmount] = useState(String(presets[0] ?? Math.min(1, perWalletSTT)))

  const { data: existing } = useReadContract({
    address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'contributions',
    args: [BigInt(pool.id), address!], query: { enabled: !!address },
  })
  const { data: verified } = useReadContract({
    address: ADDRESSES.SybilRegistry, abi: SYBIL_REGISTRY_ABI, functionName: 'isVerified',
    args: [address!, pool.minSybilScore], query: { enabled: !!address && pool.minSybilScore > 0 },
  })

  const live = poolStatus(pool) === 'live'
  const locked = pool.minSybilScore > 0 && !verified
  const tokensOut = (() => { try { return (parseEther(amount) * 10n ** 18n) / pool.tokenPrice } catch { return 0n } })()

  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (isSuccess) { const t = setTimeout(onDone, 1400); return () => clearTimeout(t) } }, [isSuccess, onDone])

  const invest = () => {
    if (!amount) return
    writeContract({
      address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'participate',
      args: [BigInt(pool.id)], value: parseEther(amount),
    })
  }

  const busy = isPending || confirming

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-zinc-900 border-t sm:border border-zinc-800 sm:rounded-2xl rounded-t-2xl p-6 space-y-5 animate-[slideUp_.25s_ease]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TokenLogo address={pool.projectToken} symbol={symbol} size={40} rounded={0.3} />
            <div>
              <p className="font-semibold text-zinc-100">Back {symbol}</p>
              <p className="text-xs text-zinc-500">Pool #{pool.id} · {formatEther(pool.tokenPrice)} STT / token</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><ChevronUp size={18} className="rotate-180" /></button>
        </div>

        {isSuccess ? (
          <div className="py-6 text-center space-y-2">
            <CheckCircle2 size={36} className="text-emerald-400 mx-auto" />
            <p className="font-medium text-emerald-300">You're in!</p>
            <p className="text-xs text-zinc-400">Contributed {amount} STT to {symbol}</p>
            <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              View transaction <ExternalLink size={11} />
            </a>
          </div>
        ) : locked ? (
          <div className="space-y-4">
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <Lock size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">Verification required</p>
                <p className="text-xs text-zinc-400 mt-0.5">This pool needs a Sybil score ≥ {pool.minSybilScore}. Get verified once — it's reusable everywhere.</p>
              </div>
            </div>
            <Link to="/registry" className="btn-primary w-full flex items-center justify-center gap-2">
              <ShieldCheck size={14} /> Get verified
            </Link>
          </div>
        ) : !live ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-center text-sm text-zinc-400">
            This pool hasn't opened yet — check back when it goes live.
          </div>
        ) : (
          <>
            {/* Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-400 font-medium">Amount (STT)</label>
                <span className="text-xs text-zinc-500">Max {perWalletSTT} STT / wallet</span>
              </div>
              <div className="flex gap-2">
                {presets.map(v => (
                  <button key={v} onClick={() => setAmount(String(v))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      amount === String(v) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                    }`}>{v}</button>
                ))}
              </div>
              <input
                type="number" className="input" value={amount} min="0" step="0.1"
                max={perWalletSTT} onChange={e => setAmount(e.target.value)}
                placeholder="Custom amount"
              />
            </div>

            {/* You receive */}
            <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 flex items-center justify-between">
              <span className="text-xs text-zinc-500">You receive (if it succeeds)</span>
              <span className="text-sm font-semibold text-zinc-100">
                ≈ {Number(formatEther(tokensOut)).toLocaleString()} {symbol}
              </span>
            </div>

            {/* Protection notes */}
            <div className="space-y-1.5">
              {Number(pool.buyerVest) > 0 && (
                <p className="text-xs text-sky-300/90 flex items-center gap-1.5">
                  <Clock size={11} /> Tokens unlock linearly over {Math.max(1, Math.round(Number(pool.buyerVest) / 86400))} day(s) after launch.
                </p>
              )}
              {pool.usesTreasury && (
                <p className="text-xs text-emerald-300/90 flex items-center gap-1.5">
                  <ShieldCheck size={11} /> Funds are escrowed — released to the team only as AI verifies milestones. You can claw back the rest.
                </p>
              )}
            </div>

            {existing !== undefined && (existing as bigint) > 0n && (
              <p className="text-xs text-indigo-300">Already in for {formatEther(existing as bigint)} STT — this adds to it.</p>
            )}

            <button className="btn-primary w-full flex items-center justify-center gap-2 py-3" onClick={invest}
              disabled={busy || !amount || Number(amount) <= 0}>
              {busy && <RefreshCw size={14} className="animate-spin" />}
              {isPending ? 'Confirm in wallet…' : confirming ? 'Investing…' : <><Zap size={14} /> Back this launch</>}
            </button>
            <p className="text-center text-[11px] text-zinc-600">
              Refunded automatically if the pool misses its soft cap.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800">
      <div className="flex items-center gap-1 text-zinc-500">{icon}<span>{label}</span></div>
      <p className="text-sm font-medium text-zinc-200 mt-0.5">{value}</p>
    </div>
  )
}

function Overlay({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 card flex flex-col items-center justify-center text-center gap-3 p-8">
      {icon}
      <div>
        <p className="font-semibold text-zinc-200">{title}</p>
        <p className="text-sm text-zinc-500 mt-1">{sub}</p>
      </div>
      {action}
    </div>
  )
}
