import { useEffect, useState, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, formatEther } from 'viem'
import { Cpu, Sparkles, Activity, RefreshCw, Bot, Zap } from 'lucide-react'
import { ADDRESSES } from '../contracts'
import { somniaTestnet } from '../chain'

const EXPLORER = somniaTestnet.blockExplorers.default.url
const CHUNK = 990n
const LOOKBACK = 4000n

// Event sets per contract (decoded together in one getLogs call per chunk)
const SYBIL_EVENTS = [
  parseAbiItem('event AttestationRequested(address indexed wallet, uint256 indexed requestId)'),
  parseAbiItem('event AttestationStored(address indexed wallet, uint8 score, uint256 txCount, uint256 balanceWei)'),
  parseAbiItem('event AttestationFailed(address indexed wallet, uint8 status)'),
]
const LAUNCH_EVENTS = [
  parseAbiItem('event PoolCreated(uint256 indexed poolId, address indexed owner, address indexed projectToken, uint256 hardCap, uint256 softCap)'),
  parseAbiItem('event Participated(uint256 indexed poolId, address indexed participant, uint256 amount, uint256 totalRaised)'),
  parseAbiItem('event PoolFinalized(uint256 indexed poolId, bool softCapMet, uint256 totalRaised)'),
  parseAbiItem('event FundMilestoneClaimed(uint256 indexed poolId, uint256 indexed milestoneIndex, uint256 requestId)'),
  parseAbiItem('event FundMilestonePassed(uint256 indexed poolId, uint256 indexed milestoneIndex, uint256 released)'),
  parseAbiItem('event FundMilestoneFailed(uint256 indexed poolId, uint256 indexed milestoneIndex)'),
  parseAbiItem('event TreasuryClawback(uint256 indexed poolId, address indexed participant, uint256 amount)'),
]
const VESTING_EVENTS = [
  parseAbiItem('event ScheduleCreated(uint256 indexed scheduleId, address indexed beneficiary, address indexed token, uint256 totalAmount, uint256 milestoneCount)'),
  parseAbiItem('event MilestoneClaimed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 indexed parseRequestId)'),
  parseAbiItem('event MilestonePassed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 unlockedAmount)'),
  parseAbiItem('event MilestoneFailed(uint256 indexed scheduleId, uint256 indexed milestoneIndex)'),
]
const TRUST_EVENTS = [
  parseAbiItem('event ProjectRegistered(uint256 indexed poolId, string name, string domain)'),
  parseAbiItem('event TrustRequested(uint256 indexed poolId, uint256 requestId)'),
  parseAbiItem('event TrustScored(uint256 indexed poolId, uint8 score)'),
  parseAbiItem('event TrustFailed(uint256 indexed poolId)'),
]

type Lane = 'ai' | 'keeper' | 'user'
type Feed = {
  id: string; block: bigint; lane: Lane; title: string; detail: string; tx: string
}

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

function classify(eventName: string, args: any): { lane: Lane; title: string; detail: string } | null {
  switch (eventName) {
    // ── Somnia consensus AI verdicts ──
    case 'AttestationStored':
      return { lane: 'ai', title: 'Sybil AI scored a wallet', detail: `${short(args.wallet)} → score ${args.score}/100 · ${args.txCount} tx` }
    case 'AttestationFailed':
      return { lane: 'ai', title: 'Sybil AI request failed', detail: `${short(args.wallet)} · status ${args.status}` }
    case 'FundMilestonePassed':
      return { lane: 'ai', title: 'Milestone AI verdict: PASS', detail: `pool #${args.poolId} · released ${formatEther(args.released)} STT from escrow` }
    case 'FundMilestoneFailed':
      return { lane: 'ai', title: 'Milestone AI verdict: FAIL', detail: `pool #${args.poolId} milestone ${args.milestoneIndex} · funds held for clawback` }
    case 'MilestonePassed':
      return { lane: 'ai', title: 'Vesting AI verdict: PASS', detail: `schedule #${args.scheduleId} · unlocked ${formatEther(args.unlockedAmount)} tokens` }
    case 'MilestoneFailed':
      return { lane: 'ai', title: 'Vesting AI verdict: FAIL', detail: `schedule #${args.scheduleId} milestone ${args.milestoneIndex}` }
    // ── Keeper / agent invocations of the AI ──
    case 'AttestationRequested':
      return { lane: 'keeper', title: 'Invoked JSON-API agent', detail: `scoring ${short(args.wallet)} (req ${String(args.requestId).slice(0, 8)})` }
    case 'PoolFinalized':
      return { lane: 'keeper', title: 'Keeper finalized a sale', detail: `pool #${args.poolId} · ${args.softCapMet ? 'soft cap met' : 'failed'} · ${formatEther(args.totalRaised)} STT` }
    case 'FundMilestoneClaimed':
      return { lane: 'keeper', title: 'Keeper invoked milestone AI', detail: `pool #${args.poolId} milestone ${args.milestoneIndex} → verifying` }
    case 'MilestoneClaimed':
      return { lane: 'keeper', title: 'Keeper invoked vesting AI', detail: `schedule #${args.scheduleId} milestone ${args.milestoneIndex} → verifying` }
    // ── User / project actions ──
    case 'PoolCreated':
      return { lane: 'user', title: 'New launch created', detail: `pool #${args.poolId} · cap ${formatEther(args.hardCap)} STT` }
    case 'Participated':
      return { lane: 'user', title: 'Investor backed a launch', detail: `pool #${args.poolId} · ${formatEther(args.amount)} STT` }
    case 'ScheduleCreated':
      return { lane: 'user', title: 'Vesting schedule created', detail: `schedule #${args.scheduleId} · ${formatEther(args.totalAmount)} tokens` }
    case 'TreasuryClawback':
      return { lane: 'user', title: 'Investor clawed back funds', detail: `pool #${args.poolId} · ${formatEther(args.amount)} STT` }
    // ── Trust oracle ──
    case 'ProjectRegistered':
      return { lane: 'user', title: 'Project registered for trust scoring', detail: `pool #${args.poolId} · ${args.name} (${args.domain})` }
    case 'TrustRequested':
      return { lane: 'keeper', title: 'Keeper invoked Trust AI', detail: `pool #${args.poolId} → scoring project legitimacy` }
    case 'TrustScored':
      return { lane: 'ai', title: 'Trust AI scored a project', detail: `pool #${args.poolId} → ${args.score}/100 legitimacy` }
    case 'TrustFailed':
      return { lane: 'ai', title: 'Trust AI scoring failed', detail: `pool #${args.poolId}` }
    default:
      return null
  }
}

const LANE_META: Record<Lane, { label: string; icon: React.ReactNode; cls: string; dot: string }> = {
  ai:     { label: 'Somnia AI',  icon: <Sparkles size={13} />, cls: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20', dot: 'bg-indigo-400' },
  keeper: { label: 'Keeper',     icon: <Bot size={13} />,      cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400' },
  user:   { label: 'On-chain',   icon: <Zap size={13} />,      cls: 'text-zinc-300 bg-zinc-700/30 border-zinc-700', dot: 'bg-zinc-500' },
}

export default function Agents() {
  const client = usePublicClient()
  const [feed, setFeed] = useState<Feed[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const scan = useCallback(async () => {
    if (!client) return
    const latest = await client.getBlockNumber()
    const from = latest > LOOKBACK ? latest - LOOKBACK : 0n

    const sources: { address: `0x${string}`; events: any[] }[] = [
      { address: ADDRESSES.SybilRegistry, events: SYBIL_EVENTS },
      { address: ADDRESSES.LaunchPool,    events: LAUNCH_EVENTS },
      { address: ADDRESSES.VestingVault,  events: VESTING_EVENTS },
      { address: ADDRESSES.TrustOracle,   events: TRUST_EVENTS },
    ]

    const items: Feed[] = []
    for (const src of sources) {
      let b = from
      while (b <= latest) {
        const to = b + CHUNK > latest ? latest : b + CHUNK
        const logs = await client.getLogs({ address: src.address, events: src.events, fromBlock: b, toBlock: to }).catch(() => [] as any[])
        for (const l of logs as any[]) {
          const c = classify(l.eventName, l.args)
          if (!c) continue
          items.push({
            id: `${l.transactionHash}-${l.logIndex}`,
            block: l.blockNumber as bigint,
            lane: c.lane, title: c.title, detail: c.detail,
            tx: l.transactionHash as string,
          })
        }
        b = to + 1n
      }
    }

    items.sort((a, b) => Number(b.block - a.block))
    setFeed(items.slice(0, 50))
    setLoading(false)
  }, [client])

  useEffect(() => { scan() }, [scan, tick])
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 12_000); return () => clearInterval(id) }, [])

  const counts = {
    ai: feed.filter(f => f.lane === 'ai').length,
    keeper: feed.filter(f => f.lane === 'keeper').length,
    user: feed.filter(f => f.lane === 'user').length,
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs px-3 py-1.5 rounded-full mb-3">
          <Cpu size={12} /> Agent-operated · no human in the loop
        </div>
        <h1 className="display text-2xl font-bold text-zinc-50 tracking-tightest">Agent Activity</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-xl">
          Every line below is an autonomous action — Somnia's consensus AI making decisions, and the
          keeper agent operating the protocol. The launchpad runs itself.
        </p>
      </div>

      {/* Lane summary */}
      <div className="grid grid-cols-3 gap-3">
        <LaneCard lane="ai" count={counts.ai} blurb="AI verdicts" />
        <LaneCard lane="keeper" count={counts.keeper} blurb="Keeper actions" />
        <LaneCard lane="user" count={counts.user} blurb="On-chain events" />
      </div>

      {/* Feed */}
      <div className="card divide-y divide-zinc-800">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Activity size={15} className="text-emerald-400" />
            Live activity
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> streaming
            </span>
          </div>
          <button onClick={() => setTick(t => t + 1)} className="btn-ghost text-xs flex items-center gap-1.5">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">Scanning the chain…</div>
        ) : feed.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">
            No recent agent activity. Run <code className="text-zinc-300">npm run demo</code> and{' '}
            <code className="text-zinc-300">npm run keeper</code> to see it operate itself.
          </div>
        ) : (
          feed.map(f => {
            const m = LANE_META[f.lane]
            return (
              <a key={f.id} href={`${EXPLORER}/tx/${f.tx}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                <span className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center ${m.cls}`}>{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-zinc-100 truncate">{f.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${m.cls} shrink-0`}>{m.label}</span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{f.detail}</p>
                </div>
                <span className="text-[10px] text-zinc-600 font-mono shrink-0">#{f.block.toString().slice(-6)}</span>
              </a>
            )
          })
        )}
      </div>

      {/* Discoverable manifest */}
      <a href="/.well-known/agent.json" target="_blank" rel="noopener noreferrer"
        className="card p-4 flex items-center gap-3 hover:border-zinc-700 transition-colors">
        <span className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
          <Cpu size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">Agent-discoverable manifest</p>
          <p className="text-xs text-zinc-500 truncate">
            Other agents can discover & invoke VeraLaunch via <code className="text-zinc-400">/.well-known/agent.json</code> — contracts, callable actions, and the Somnia agents each one invokes.
          </p>
        </div>
      </a>

      <p className="text-center text-xs text-zinc-600">
        Discovery is read straight from chain state · actions are real transactions you can open on the explorer.
      </p>
    </div>
  )
}

function LaneCard({ lane, count, blurb }: { lane: Lane; count: number; blurb: string }) {
  const m = LANE_META[lane]
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center ${m.cls}`}>{m.icon}</span>
        <span className="text-sm font-medium text-zinc-200">{m.label}</span>
      </div>
      <p className="text-2xl font-bold text-zinc-50 mt-3">{count}</p>
      <p className="text-xs text-zinc-500">{blurb} (recent)</p>
    </div>
  )
}
