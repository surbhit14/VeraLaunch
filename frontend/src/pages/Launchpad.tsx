import { useState, useEffect, useMemo } from 'react'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther, maxUint256 } from 'viem'
import { Rocket, Plus, ExternalLink, AlertCircle, RefreshCw, CheckCircle, ShieldCheck } from 'lucide-react'
import { ADDRESSES, LAUNCH_POOL_ABI, SYBIL_REGISTRY_ABI, ERC20_ABI } from '../contracts'
import { TokenLogo } from '../components/TokenLogo'
import { somniaTestnet } from '../chain'

const EXPLORER = somniaTestnet.blockExplorers.default.url

type Pool = {
  projectToken: `0x${string}`
  tokenPrice: bigint
  hardCap: bigint
  softCap: bigint
  perWalletCap: bigint
  totalTokens: bigint
  startTime: bigint
  endTime: bigint
  totalRaised: bigint
  minSybilScore: number
  finalized: boolean
  softCapMet: boolean
}

function useCountdown(target: bigint) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const update = () => {
      const diff = Number(target) - Math.floor(Date.now() / 1000)
      if (diff <= 0) { setLabel('Ended'); return }
      const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [target])
  return label
}

export default function Launchpad() {
  const [tab, setTab] = useState<'pools' | 'create'>('pools')

  const { data: nextId } = useReadContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'nextPoolId',
  })

  const poolCount = nextId ? Number(nextId) : 0

  const poolContracts = useMemo(
    () => Array.from({ length: poolCount }, (_, i) => ({
      address: ADDRESSES.LaunchPool,
      abi: LAUNCH_POOL_ABI,
      functionName: 'pools' as const,
      args: [BigInt(i)] as const,
    })),
    [poolCount],
  )

  const { data: poolResults, refetch: refetchPools } = useReadContracts({
    contracts: poolContracts,
    query: { refetchInterval: 20_000 },   // keep pool state live (finalization, totalRaised)
  })

  // viem may return either named-object OR positional-array depending on version/wrapper.
  // This helper handles both: tries named first, falls back to positional index.
  const g = (d: any, name: string, idx: number) => d?.[name] !== undefined ? d[name] : d?.[idx]

  const pools: (Pool & { id: number })[] = (poolResults ?? [])
    .map((r: any, i: number) => {
      if (r.status !== 'success') return null
      const d = r.result as any
      if (!d) return null
      return {
        id: i,
        projectToken:  g(d, 'projectToken',  0)  as `0x${string}`,
        tokenPrice:    g(d, 'tokenPrice',     1)  as bigint,
        hardCap:       g(d, 'hardCap',        2)  as bigint,
        softCap:       g(d, 'softCap',        3)  as bigint,
        perWalletCap:  g(d, 'perWalletCap',   4)  as bigint,
        totalTokens:   g(d, 'totalTokens',    5)  as bigint,
        startTime:     g(d, 'startTime',      6)  as bigint,
        endTime:       g(d, 'endTime',        7)  as bigint,
        totalRaised:   g(d, 'totalRaised',    8)  as bigint,
        minSybilScore: Number(g(d, 'minSybilScore', 9)),
        finalized:     Boolean(g(d, 'finalized',    10)),
        softCapMet:    Boolean(g(d, 'softCapMet',   11)),
      }
    })
    .filter(Boolean) as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">For projects</p>
          <h1 className="display text-2xl font-bold text-zinc-50 tracking-tightest">Launchpad</h1>
          <p className="text-sm text-zinc-400 mt-1">Sybil-gated IDO pools on Somnia testnet</p>
        </div>
        <div className="flex gap-2">
          <TabBtn active={tab === 'pools'}  onClick={() => setTab('pools')}>
            All Pools {poolCount > 0 && <span className="ml-1.5 bg-zinc-700 text-zinc-300 text-xs px-1.5 py-0.5 rounded-md">{poolCount}</span>}
          </TabBtn>
          <TabBtn active={tab === 'create'} onClick={() => setTab('create')}>
            <Plus size={14} /> Create Pool
          </TabBtn>
        </div>
      </div>

      {tab === 'pools' && (
        pools.length === 0 ? (
          <Empty icon={<Rocket size={32} className="text-zinc-600" />} text="No pools yet" sub="Create the first IDO pool" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pools.map(p => (
              <PoolCard key={p.id} pool={p} onAction={refetchPools} />
            ))}
          </div>
        )
      )}

      {tab === 'create' && <CreatePoolForm onCreated={() => { refetchPools(); setTab('pools') }} />}
    </div>
  )
}

function PoolCard({ pool, onAction }: { pool: Pool & { id: number }; onAction: () => void }) {
  const { address } = useAccount()
  const now = BigInt(Math.floor(Date.now() / 1000))

  const status = pool.finalized ? 'finalized'
    : now < pool.startTime ? 'upcoming'
    : now > pool.endTime   ? 'ended'
    : 'live'

  const countdown = useCountdown(status === 'upcoming' ? (pool.startTime ?? 0n) : (pool.endTime ?? 0n))
  const progress  = pool.hardCap && pool.hardCap > 0n ? Number(((pool.totalRaised ?? 0n) * 100n) / pool.hardCap) : 0

  const { data: tokenSym } = useReadContract({
    address: pool.projectToken,
    abi: ERC20_ABI,
    functionName: 'symbol',
    query: { enabled: !!pool.projectToken },
  })
  const { data: tokenName } = useReadContract({
    address: pool.projectToken,
    abi: ERC20_ABI,
    functionName: 'name',
    query: { enabled: !!pool.projectToken },
  })

  const { data: ownerAddr } = useReadContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'poolOwner',
    args: [BigInt(pool.id)],
  })

  const { data: contribution } = useReadContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'contributions',
    args: [BigInt(pool.id), address!],
    query: { enabled: !!address },
  })

  const { data: sybilCheck } = useReadContract({
    address: ADDRESSES.SybilRegistry,
    abi: SYBIL_REGISTRY_ABI,
    functionName: 'isVerified',
    args: [address!, pool.minSybilScore],
    query: { enabled: !!address },
  })

  const isOwner   = address && ownerAddr?.toLowerCase() === address.toLowerCase()
  const hasContrib = contribution !== undefined && contribution > 0n

  const [amount, setAmount] = useState('1')
  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: txDone } = useWaitForTransactionReceipt({ hash })

  useEffect(() => { if (txDone) { onAction(); reset() } }, [txDone, onAction, reset])

  const handleParticipate = () => {
    if (!amount) return
    writeContract({
      address: ADDRESSES.LaunchPool,
      abi: LAUNCH_POOL_ABI,
      functionName: 'participate',
      args: [BigInt(pool.id)],
      value: parseEther(amount),
    })
  }

  const handleFinalize = () => writeContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'finalize',
    args: [BigInt(pool.id)],
  })

  const handleClaim = () => writeContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'claimTokens',
    args: [BigInt(pool.id)],
  })

  const handleRefund = () => writeContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'refund',
    args: [BigInt(pool.id)],
  })

  const busy = isPending || confirming

  return (
    <div className="card p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TokenLogo address={pool.projectToken} symbol={tokenSym as string} size={40} rounded={0.3} />
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-zinc-100">{tokenSym ?? '…'}</span>
              <span className="text-xs text-zinc-500">Pool #{pool.id}</span>
            </div>
            <p className="text-xs text-zinc-400">{tokenName ?? (pool.projectToken ? pool.projectToken.slice(0, 10) + '…' : '…')}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-400">
          <span>{formatEther(pool.totalRaised)} STT raised</span>
          <span>{formatEther(pool.hardCap)} STT cap</span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-1.5">
          <div
            className="bg-indigo-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{progress}%</span>
          <span>Soft cap: {formatEther(pool.softCap)} STT</span>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MetaRow label="Price" value={`${formatEther(pool.tokenPrice)} STT`} />
        <MetaRow label="Min Score" value={pool.minSybilScore === 0 ? 'None' : `${pool.minSybilScore}/100`} />
        <MetaRow label="Per wallet" value={`${formatEther(pool.perWalletCap)} STT`} />
        <MetaRow
          label={status === 'upcoming' ? 'Starts in' : status === 'live' ? 'Ends in' : 'Ended'}
          value={status !== 'finalized' ? countdown : '—'}
        />
      </div>

      {/* Contribution status */}
      {hasContrib && (
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2 text-xs text-indigo-300">
          Your contribution: {formatEther(contribution!)} STT
        </div>
      )}

      {/* Actions */}
      {address && (
        <div className="border-t border-zinc-800 pt-4 space-y-3">
          {status === 'live' && !hasContrib && (
            <>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input"
                  placeholder={`Amount (max ${formatEther(pool.perWalletCap)} STT)`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  min="0"
                  step="0.1"
                />
                <button
                  className="btn-primary shrink-0 flex items-center gap-2"
                  onClick={handleParticipate}
                  disabled={busy || !address}
                >
                  {busy && <RefreshCw size={12} className="animate-spin" />}
                  Join
                </button>
              </div>
              {pool.minSybilScore > 0 && !sybilCheck && address && (
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertCircle size={12} />
                  Score ≥ {pool.minSybilScore} required — visit Registry to get attested
                </div>
              )}
            </>
          )}

          {status === 'ended' && isOwner && !pool.finalized && (
            <button className="btn-secondary w-full flex items-center justify-center gap-2" onClick={handleFinalize} disabled={busy}>
              {busy && <RefreshCw size={12} className="animate-spin" />}
              Finalize Pool
            </button>
          )}

          {pool.finalized && hasContrib && pool.softCapMet && (
            <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={handleClaim} disabled={busy}>
              {busy && <RefreshCw size={12} className="animate-spin" />}
              <CheckCircle size={13} /> Claim Tokens
            </button>
          )}

          {pool.finalized && hasContrib && !pool.softCapMet && (
            <button className="btn-secondary w-full flex items-center justify-center gap-2" onClick={handleRefund} disabled={busy}>
              {busy && <RefreshCw size={12} className="animate-spin" />}
              Refund STT
            </button>
          )}

          {pool.finalized && !hasContrib && (
            <p className="text-xs text-zinc-500 text-center">
              {pool.softCapMet ? `IDO succeeded · ${formatEther(pool.totalRaised)} STT raised` : 'IDO failed — soft cap not met'}
            </p>
          )}

          {pool.finalized && pool.softCapMet && (
            <TreasuryPanel poolId={pool.id} isOwner={!!isOwner} hasContrib={hasContrib} onAction={onAction} />
          )}

          {hash && (
            <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              <ExternalLink size={11} /> View transaction
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function CreatePoolForm({ onCreated }: { onCreated: () => void }) {
  const { address } = useAccount()
  const [form, setForm] = useState({
    tokenAddress: ADDRESSES.MockERC20,
    tokenPrice: '0.001',
    hardCap: '10',
    softCap: '2',
    perWalletCap: '2',
    totalTokens: '1000',
    startDelaySec: '60',
    durationSec: '3600',
    minSybilScore: '0',
    buyerVestDays: '0',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  // Optional milestone-gated treasury. Empty = team gets the raise on finalize.
  type FM = { description: string; evidenceDomain: string; releaseBps: string; deadlineDays: string }
  const [useTreasury, setUseTreasury] = useState(false)
  const [milestones, setMilestones] = useState<FM[]>([
    { description: '', evidenceDomain: '', releaseBps: '10000', deadlineDays: '30' },
  ])
  const updateM = (i: number, k: keyof FM, v: string) =>
    setMilestones(ms => ms.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)))
  const addM = () => setMilestones(ms => [...ms, { description: '', evidenceDomain: '', releaseBps: '', deadlineDays: '60' }])
  const removeM = (i: number) => setMilestones(ms => ms.filter((_, idx) => idx !== i))
  const bpsSum = useTreasury ? milestones.reduce((s, m) => s + (parseInt(m.releaseBps) || 0), 0) : 10000
  const bpsOk = !useTreasury || bpsSum === 10000

  // Check + handle approval first
  const validTokenAddr = /^0x[0-9a-fA-F]{40}$/.test(form.tokenAddress)
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: form.tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, ADDRESSES.LaunchPool],
    query: { enabled: !!address && validTokenAddr },
  })

  const totalTokensBn = (() => { try { return parseEther(form.totalTokens) } catch { return 0n } })()
  const needsApproval = (allowance ?? 0n) < totalTokensBn

  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: txDone } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (txDone) {
      if (needsApproval) { refetchAllowance(); reset() }
      else { onCreated(); reset() }
    }
  }, [txDone, needsApproval, refetchAllowance, onCreated, reset])

  const handleApprove = () => writeContract({
    address: form.tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [ADDRESSES.LaunchPool, maxUint256],
  })

  const handleCreate = () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const start = now + BigInt(form.startDelaySec)
    const end   = start + BigInt(form.durationSec)
    const fundMilestones = useTreasury
      ? milestones.map(m => ({
          description:    m.description,
          evidenceDomain: m.evidenceDomain,
          releaseBps:     parseInt(m.releaseBps) || 0,
          deadline:       end + BigInt((parseInt(m.deadlineDays) || 1) * 86400),
        }))
      : []
    writeContract({
      address: ADDRESSES.LaunchPool,
      abi: LAUNCH_POOL_ABI,
      functionName: 'createPool',
      args: [{
        projectToken:  form.tokenAddress as `0x${string}`,
        tokenPrice:    parseEther(form.tokenPrice),
        hardCap:       parseEther(form.hardCap),
        softCap:       parseEther(form.softCap),
        perWalletCap:  parseEther(form.perWalletCap),
        totalTokens:   totalTokensBn,
        startTime:     start,
        endTime:       end,
        minSybilScore: Number(form.minSybilScore),
        buyerCliff:    0n,
        buyerVest:     BigInt(Math.round((parseFloat(form.buyerVestDays) || 0) * 86400)),
      }, fundMilestones],
    })
  }

  const busy = isPending || confirming

  if (!address) return (
    <div className="card p-8 text-center text-zinc-400 text-sm">Connect your wallet to create a pool</div>
  )

  return (
    <div className="card p-6 max-w-lg space-y-5">
      <h2 className="font-semibold text-zinc-100">Create IDO Pool</h2>

      <FormGroup label="Project Token Address">
        <input className="input font-mono text-xs" value={form.tokenAddress} onChange={set('tokenAddress')} />
      </FormGroup>

      <div className="grid grid-cols-2 gap-3">
        <FormGroup label="Token Price (STT/token)">
          <input className="input" type="number" step="0.0001" value={form.tokenPrice} onChange={set('tokenPrice')} />
        </FormGroup>
        <FormGroup label="Total Tokens">
          <input className="input" type="number" value={form.totalTokens} onChange={set('totalTokens')} />
        </FormGroup>
        <FormGroup label="Hard Cap (STT)">
          <input className="input" type="number" value={form.hardCap} onChange={set('hardCap')} />
        </FormGroup>
        <FormGroup label="Soft Cap (STT)">
          <input className="input" type="number" value={form.softCap} onChange={set('softCap')} />
        </FormGroup>
        <FormGroup label="Per-Wallet Cap (STT)">
          <input className="input" type="number" value={form.perWalletCap} onChange={set('perWalletCap')} />
        </FormGroup>
        <FormGroup label="Min Sybil Score (0 = open)">
          <input className="input" type="number" min="0" max="100" value={form.minSybilScore} onChange={set('minSybilScore')} />
        </FormGroup>
        <FormGroup label="Starts in (seconds)">
          <input className="input" type="number" value={form.startDelaySec} onChange={set('startDelaySec')} />
        </FormGroup>
        <FormGroup label="Duration (seconds)">
          <input className="input" type="number" value={form.durationSec} onChange={set('durationSec')} />
        </FormGroup>
        <FormGroup label="Buyer vesting (days, 0 = instant)">
          <input className="input" type="number" min="0" step="1" value={form.buyerVestDays} onChange={set('buyerVestDays')} />
        </FormGroup>
      </div>

      {/* Milestone-gated treasury */}
      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={useTreasury} onChange={e => setUseTreasury(e.target.checked)} className="accent-indigo-600" />
          <span className="text-sm font-medium text-zinc-200">Escrow the raise — release funds via AI-verified milestones</span>
        </label>
        <p className="text-xs text-zinc-500">
          Builds investor trust: the raised STT is held and only released to you as the AI confirms
          each milestone. Investors claw back any unspent funds if a milestone fails.
        </p>

        {useTreasury && (
          <div className="space-y-3">
            {!bpsOk && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertCircle size={12} /> Release shares must sum to 10000 bps (currently {bpsSum}).
              </div>
            )}
            {milestones.map((m, i) => (
              <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-400">Milestone {i + 1}</span>
                  {milestones.length > 1 && (
                    <button onClick={() => removeM(i)} className="text-zinc-600 hover:text-zinc-400 text-xs">remove</button>
                  )}
                </div>
                <input className="input" placeholder="Claim, e.g. Mainnet launched with 10k users" value={m.description} onChange={e => updateM(i, 'description', e.target.value)} />
                <div className="grid grid-cols-3 gap-2">
                  <input className="input col-span-1" placeholder="domain.com" value={m.evidenceDomain} onChange={e => updateM(i, 'evidenceDomain', e.target.value)} />
                  <input className="input" type="number" placeholder="bps (of 10000)" value={m.releaseBps} onChange={e => updateM(i, 'releaseBps', e.target.value)} />
                  <input className="input" type="number" placeholder="deadline +days" value={m.deadlineDays} onChange={e => updateM(i, 'deadlineDays', e.target.value)} />
                </div>
              </div>
            ))}
            <button onClick={addM} className="btn-ghost text-xs">+ Add milestone</button>
          </div>
        )}
      </div>

      <div className="pt-2">
        {needsApproval ? (
          <button className="btn-secondary w-full flex items-center justify-center gap-2" onClick={handleApprove} disabled={busy}>
            {busy && <RefreshCw size={12} className="animate-spin" />}
            Approve Token Transfer
          </button>
        ) : (
          <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={handleCreate} disabled={busy || !bpsOk}>
            {busy && <RefreshCw size={12} className="animate-spin" />}
            Create Pool
          </button>
        )}
      </div>

      {hash && (
        <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          <ExternalLink size={11} /> View transaction
        </a>
      )}
    </div>
  )
}

function TreasuryPanel({ poolId, isOwner, hasContrib, onAction }: { poolId: number; isOwner: boolean; hasContrib: boolean; onAction: () => void }) {
  const { address } = useAccount()
  const { data: milestones, refetch } = useReadContract({
    address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'getFundMilestones',
    args: [BigInt(poolId)], query: { refetchInterval: 12_000 },
  })
  const { data: clawable } = useReadContract({
    address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'getClawbackable',
    args: [BigInt(poolId), address!], query: { enabled: !!address, refetchInterval: 12_000 },
  })
  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (isSuccess) { refetch(); onAction(); reset() } }, [isSuccess, refetch, onAction, reset])

  const ms = (milestones ?? []) as any[]
  if (ms.length === 0) return null
  const busy = isPending || confirming
  const nowSec = Math.floor(Date.now() / 1000)

  const verify = (i: number) => writeContract({
    address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'claimFundMilestone',
    args: [BigInt(poolId), BigInt(i)], value: parseEther('0.80'),
  })
  const doClawback = () => writeContract({
    address: ADDRESSES.LaunchPool, abi: LAUNCH_POOL_ABI, functionName: 'clawback', args: [BigInt(poolId)],
  })

  return (
    <div className="border-t border-zinc-800 pt-3 space-y-2">
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide flex items-center gap-1">
        <ShieldCheck size={12} /> Milestone treasury
      </p>
      {ms.map((m, i) => {
        const st = Number(m.status ?? m[4])
        const desc = (m.description ?? m[0]) as string
        const bps = Number(m.releaseBps ?? m[2])
        const overdue = nowSec > Number(m.deadline ?? m[3])
        return (
          <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-zinc-300 leading-snug">{desc || `Milestone ${i + 1}`}</span>
              <span className="text-zinc-500 shrink-0">{(bps / 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={st === 2 ? 'text-emerald-400' : st === 3 || overdue ? 'text-red-400' : st === 1 ? 'text-amber-400' : 'text-zinc-500'}>
                {st === 2 ? 'Passed · released' : st === 3 ? 'Failed' : st === 1 ? 'Verifying…' : overdue ? 'Expired' : 'Pending'}
              </span>
              {isOwner && st === 0 && !overdue && (
                <button onClick={() => verify(i)} disabled={busy} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-40 flex items-center gap-1">
                  {busy && <RefreshCw size={9} className="animate-spin" />} Verify (0.8 STT)
                </button>
              )}
            </div>
          </div>
        )
      })}
      {hasContrib && clawable !== undefined && (clawable as bigint) > 0n && (
        <button onClick={doClawback} disabled={busy} className="btn-secondary w-full flex items-center justify-center gap-2 text-xs">
          {busy && <RefreshCw size={11} className="animate-spin" />}
          Claw back {formatEther(clawable as bigint)} STT
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'live')      return <span className="badge-live">Live</span>
  if (status === 'upcoming')  return <span className="badge-upcoming">Upcoming</span>
  if (status === 'ended')     return <span className="badge-ended">Ended</span>
  if (status === 'finalized') return <span className="badge-ended">Finalized</span>
  return null
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-zinc-500">{label}: </span>
      <span className="text-zinc-300">{value}</span>
    </div>
  )
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-400 font-medium">{label}</label>
      {children}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function Empty({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      {icon}
      <p className="text-zinc-300 font-medium">{text}</p>
      {sub && <p className="text-sm text-zinc-500">{sub}</p>}
    </div>
  )
}
