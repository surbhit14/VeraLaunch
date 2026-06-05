import { useState, useEffect, useMemo, useRef } from 'react'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther, maxUint256 } from 'viem'
import {
  GitBranch, Plus, CheckCircle, XCircle, Clock, Loader, RefreshCw,
  ExternalLink, AlertTriangle, RotateCcw, ShieldAlert, CheckCircle2,
} from 'lucide-react'
import { ADDRESSES, VESTING_VAULT_ABI, ERC20_ABI } from '../contracts'
import { somniaTestnet } from '../chain'

const EXPLORER = somniaTestnet.blockExplorers.default.url

const STATUS_LABELS  = ['Pending', 'Verifying', 'Passed', 'Failed'] as const
const STATUS_ICONS   = [
  <Clock size={13} className="text-zinc-400" />,
  <Loader size={13} className="text-amber-400 animate-spin" />,
  <CheckCircle size={13} className="text-emerald-400" />,
  <XCircle size={13} className="text-red-400" />,
]
const STATUS_CLASSES = [
  'text-zinc-400', 'text-amber-400', 'text-emerald-400', 'text-red-400',
]

type Milestone = {
  description: string
  evidenceUrl: string
  unlockAmount: bigint
  deadline: bigint
  status: number
}

type Schedule = {
  id: number
  beneficiary: `0x${string}`
  token: `0x${string}`
  totalAmount: bigint
  unlockedAmount: bigint
  milestones: Milestone[]
}

export default function Vesting() {
  const [tab, setTab] = useState<'schedules' | 'create'>('schedules')

  const { data: nextId } = useReadContract({
    address: ADDRESSES.VestingVault,
    abi: VESTING_VAULT_ABI,
    functionName: 'nextScheduleId',
  })

  const schedCount = nextId ? Number(nextId) : 0

  // Track active polling and result notifications
  const [pollActive, setPollActive] = useState(false)
  const [notification, setNotification] = useState<{ text: string; type: 'pass' | 'fail' } | null>(null)
  const prevStatusRef = useRef<Map<string, number>>(new Map())

  const schedContracts = useMemo(
    () => Array.from({ length: schedCount }, (_, i) => [
      {
        address: ADDRESSES.VestingVault as `0x${string}`,
        abi: VESTING_VAULT_ABI,
        functionName: 'schedules' as const,
        args: [BigInt(i)] as const,
      },
      {
        address: ADDRESSES.VestingVault as `0x${string}`,
        abi: VESTING_VAULT_ABI,
        functionName: 'getMilestones' as const,
        args: [BigInt(i)] as const,
      },
    ]).flat(),
    [schedCount],
  )

  const { data: schedResults, refetch } = useReadContracts({
    contracts: schedContracts,
    query: { refetchInterval: pollActive ? 10_000 : false },
  })

  // Handle both named-object and positional-array viem return styles
  const gv = (d: any, name: string, idx: number) => d?.[name] !== undefined ? d[name] : d?.[idx]

  const schedules: Schedule[] = []
  if (schedResults) {
    for (let i = 0; i < schedCount; i++) {
      const sr = schedResults[i * 2]
      const mr = schedResults[i * 2 + 1]
      if (sr?.status !== 'success' || mr?.status !== 'success') continue
      const s  = sr.result as any
      if (!s) continue
      // Milestones: each tuple may be named OR positional [0]=description [1]=evidenceUrl [2]=unlockAmount [3]=deadline [4]=status
      const rawMs = (mr.result ?? []) as any[]
      const ms: Milestone[] = rawMs.map(m => ({
        description:  gv(m, 'description',  0) as string,
        evidenceUrl:  gv(m, 'evidenceUrl',  1) as string,
        unlockAmount: gv(m, 'unlockAmount', 2) as bigint,
        deadline:     gv(m, 'deadline',     3) as bigint,
        status:       Number(gv(m, 'status', 4)),
      }))
      schedules.push({
        id: i,
        beneficiary:    gv(s, 'beneficiary',    0) as `0x${string}`,
        token:          gv(s, 'token',          1) as `0x${string}`,
        totalAmount:    gv(s, 'totalAmount',    2) as bigint,
        unlockedAmount: gv(s, 'unlockedAmount', 3) as bigint,
        milestones: ms,
      })
    }
  }

  // Activate polling when any milestone is VERIFYING; detect PASS/FAIL transitions
  useEffect(() => {
    let hasVerifying = false
    const newMap = new Map<string, number>()

    for (const s of schedules) {
      for (let i = 0; i < s.milestones.length; i++) {
        const key = `${s.id}-${i}`
        const status = Number(s.milestones[i].status)
        newMap.set(key, status)
        if (status === 1) hasVerifying = true

        const prev = prevStatusRef.current.get(key)
        if (prev === 1 && status === 2) {
          setNotification({ text: `Milestone passed: "${s.milestones[i].description.slice(0, 40)}…"`, type: 'pass' })
          setTimeout(() => setNotification(null), 8000)
        }
        if (prev === 1 && status === 3) {
          setNotification({ text: `Milestone failed: "${s.milestones[i].description.slice(0, 40)}…"`, type: 'fail' })
          setTimeout(() => setNotification(null), 8000)
        }
      }
    }

    prevStatusRef.current = newMap
    setPollActive(hasVerifying)
  }, [schedules])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">For teams</p>
          <h1 className="display text-2xl font-bold text-zinc-50 tracking-tightest">Vesting</h1>
          <p className="text-sm text-zinc-400 mt-1">Milestone-gated token vesting verified by AI agents</p>
        </div>
        <div className="flex gap-2">
          <TabBtn active={tab === 'schedules'} onClick={() => setTab('schedules')}>
            Schedules
            {schedCount > 0 && <span className="ml-1.5 bg-zinc-700 text-zinc-300 text-xs px-1.5 py-0.5 rounded-md">{schedCount}</span>}
          </TabBtn>
          <TabBtn active={tab === 'create'} onClick={() => setTab('create')}>
            <Plus size={14} /> Create Schedule
          </TabBtn>
        </div>
      </div>

      {/* AI result notification */}
      {notification && (
        <div className={`rounded-xl p-4 flex items-center gap-3 border ${
          notification.type === 'pass'
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : 'bg-red-500/10 border-red-500/20'
        }`}>
          {notification.type === 'pass'
            ? <CheckCircle size={18} className="text-emerald-400 shrink-0" />
            : <XCircle size={18} className="text-red-400 shrink-0" />}
          <p className={`text-sm font-medium ${notification.type === 'pass' ? 'text-emerald-300' : 'text-red-300'}`}>
            {notification.text}
          </p>
        </div>
      )}

      {/* AI polling indicator */}
      {pollActive && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2.5">
          <Loader size={12} className="animate-spin shrink-0" />
          <span>AI pipeline running for one or more milestones — polling every 10 s for results</span>
        </div>
      )}

      {tab === 'schedules' && (
        schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <GitBranch size={32} className="text-zinc-600" />
            <p className="text-zinc-300 font-medium">No schedules yet</p>
            <p className="text-sm text-zinc-500">Create the first vesting schedule</p>
          </div>
        ) : (
          <div className="space-y-4">
            {schedules.map(s => (
              <ScheduleCard key={s.id} schedule={s} onAction={refetch} />
            ))}
          </div>
        )
      )}

      {tab === 'create' && <CreateScheduleForm onCreated={() => { refetch(); setTab('schedules') }} />}
    </div>
  )
}

function ScheduleCard({ schedule, onAction }: { schedule: Schedule; onAction: () => void }) {
  const { address } = useAccount()
  const isBeneficiary = address?.toLowerCase() === schedule.beneficiary.toLowerCase()
  const progress = schedule.totalAmount > 0n
    ? Number((schedule.unlockedAmount * 100n) / schedule.totalAmount)
    : 0
  const nowSec = BigInt(Math.floor(Date.now() / 1000))

  const { data: tokenSym } = useReadContract({
    address: schedule.token,
    abi: ERC20_ABI,
    functionName: 'symbol',
  })

  const allExpired = schedule.milestones.every(
    m => Number(m.status) === 3 || Number(m.status) === 2 || nowSec > m.deadline
  )

  return (
    <div className="card p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-zinc-100">{tokenSym ?? '…'}</span>
            <span className="text-xs text-zinc-500">Schedule #{schedule.id}</span>
          </div>
          <p className="text-xs text-zinc-400 font-mono">
            Beneficiary: {schedule.beneficiary.slice(0, 8)}…{schedule.beneficiary.slice(-6)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-zinc-100">{formatEther(schedule.unlockedAmount)}</p>
          <p className="text-xs text-zinc-500">of {formatEther(schedule.totalAmount)} {tokenSym} unlocked</p>
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="w-full bg-zinc-800 rounded-full h-1.5">
          <div
            className="bg-emerald-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500">{progress}% unlocked</p>
      </div>

      {/* Milestones */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Milestones</p>
        {schedule.milestones.map((m, i) => (
          <MilestoneRow
            key={i}
            index={i}
            milestone={m}
            scheduleId={schedule.id}
            isBeneficiary={!!isBeneficiary}
            onAction={onAction}
          />
        ))}
      </div>

      {/* Emergency withdraw */}
      {isBeneficiary && allExpired && schedule.unlockedAmount < schedule.totalAmount && (
        <EmergencyWithdrawBtn scheduleId={schedule.id} onAction={onAction} />
      )}
    </div>
  )
}

function MilestoneRow({
  index, milestone, scheduleId, isBeneficiary, onAction,
}: {
  index: number
  milestone: Milestone
  scheduleId: number
  isBeneficiary: boolean
  onAction: () => void
}) {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const isOverdue = nowSec > milestone.deadline
  const daysLeft = isOverdue ? 0 : Math.ceil((Number(milestone.deadline) - Number(nowSec)) / 86400)

  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: txDone } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (txDone) { onAction(); reset() } }, [txDone, onAction, reset])
  const busy = isPending || confirming

  const handleClaim = () => writeContract({
    address: ADDRESSES.VestingVault,
    abi: VESTING_VAULT_ABI,
    functionName: 'claimMilestone',
    args: [BigInt(scheduleId), BigInt(index)],
    value: parseEther('0.80'),
  })

  const handleReset = () => writeContract({
    address: ADDRESSES.VestingVault,
    abi: VESTING_VAULT_ABI,
    functionName: 'resetMilestone',
    args: [BigInt(scheduleId), BigInt(index)],
  })

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="mt-0.5 shrink-0">{STATUS_ICONS[Number(milestone.status)]}</span>
          <div className="min-w-0">
            <p className="text-sm text-zinc-200 leading-snug">{milestone.description}</p>
            <a
              href={milestone.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 mt-0.5 truncate"
            >
              <ExternalLink size={10} /> {milestone.evidenceUrl}
            </a>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium text-zinc-100">{formatEther(milestone.unlockAmount)}</p>
          <p className="text-xs text-zinc-500">tokens</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <span className={STATUS_CLASSES[Number(milestone.status)]}>{STATUS_LABELS[Number(milestone.status)]}</span>
          <span className="text-zinc-600">·</span>
          <span className={isOverdue ? 'text-red-400' : 'text-zinc-500'}>
            {isOverdue ? 'Deadline passed' : `${daysLeft}d left`}
          </span>
        </div>

        {isBeneficiary && (
          <div className="flex gap-2 shrink-0">
            {Number(milestone.status) === 0 && !isOverdue && (
              <button
                className="bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-600/20 text-indigo-400 text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40"
                onClick={handleClaim}
                disabled={busy}
              >
                {busy && <RefreshCw size={10} className="animate-spin" />}
                Verify (0.8 STT)
              </button>
            )}
            {Number(milestone.status) === 3 && !isOverdue && (
              <button
                className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40"
                onClick={handleReset}
                disabled={busy}
              >
                {busy && <RefreshCw size={10} className="animate-spin" />}
                <RotateCcw size={10} /> Retry
              </button>
            )}
            {Number(milestone.status) === 1 && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Loader size={10} className="animate-spin" /> AI verifying…
              </span>
            )}
            {Number(milestone.status) === 2 && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle size={10} /> Tokens released
              </span>
            )}
          </div>
        )}
      </div>

      {hash && (
        <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          <ExternalLink size={10} /> View transaction
        </a>
      )}
    </div>
  )
}

function EmergencyWithdrawBtn({ scheduleId, onAction }: { scheduleId: number; onAction: () => void }) {
  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: txDone } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (txDone) { onAction(); reset() } }, [txDone, onAction, reset])

  return (
    <div className="border-t border-zinc-800 pt-4 space-y-2">
      <div className="flex items-start gap-2 text-xs text-zinc-500">
        <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
        All milestone deadlines have passed. You can recover remaining locked tokens.
      </div>
      <button
        className="btn-danger flex items-center gap-2"
        onClick={() => writeContract({
          address: ADDRESSES.VestingVault,
          abi: VESTING_VAULT_ABI,
          functionName: 'emergencyWithdraw',
          args: [BigInt(scheduleId)],
        })}
        disabled={isPending || confirming}
      >
        {(isPending || confirming) && <RefreshCw size={12} className="animate-spin" />}
        <ShieldAlert size={13} /> Emergency Withdraw
      </button>
    </div>
  )
}

type MilestoneInput = { description: string; evidenceUrl: string; unlockAmount: string; deadline: string }

function CreateScheduleForm({ onCreated }: { onCreated: () => void }) {
  const { address } = useAccount()
  const [tokenAddr, setTokenAddr] = useState(ADDRESSES.MockERC20 as string)
  const [totalAmount, setTotalAmount] = useState('300')
  const [beneficiary, setBeneficiary] = useState('')
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { description: '', evidenceUrl: '', unlockAmount: '100', deadline: '' },
  ])

  useEffect(() => { if (address) setBeneficiary(address) }, [address])

  const addMilestone = () =>
    setMilestones(ms => [...ms, { description: '', evidenceUrl: '', unlockAmount: '', deadline: '' }])
  const removeMilestone = (i: number) =>
    setMilestones(ms => ms.filter((_, idx) => idx !== i))
  const updateMs = (i: number, k: keyof MilestoneInput, v: string) =>
    setMilestones(ms => ms.map((m, idx) => idx === i ? { ...m, [k]: v } : m))

  const totalMsAmount = milestones.reduce((s, m) => s + (parseFloat(m.unlockAmount) || 0), 0)
  const amountMatch   = Math.abs(totalMsAmount - parseFloat(totalAmount || '0')) < 0.000001

  // Check allowance + approve
  const validTokenAddr = /^0x[0-9a-fA-F]{40}$/.test(tokenAddr)
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, ADDRESSES.VestingVault],
    query: { enabled: !!address && validTokenAddr },
  })

  const totalBn = (() => { try { return parseEther(totalAmount) } catch { return 0n } })()
  const needsApproval = (allowance ?? 0n) < totalBn

  const { writeContract, isPending, data: hash, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: txDone } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (txDone) {
      if (needsApproval) { refetchAllowance(); reset() }
      else { onCreated(); reset() }
    }
  }, [txDone, needsApproval, refetchAllowance, onCreated, reset])

  const handleApprove = () => writeContract({
    address: tokenAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [ADDRESSES.VestingVault, maxUint256],
  })

  const handleCreate = () => {
    writeContract({
      address: ADDRESSES.VestingVault,
      abi: VESTING_VAULT_ABI,
      functionName: 'createSchedule',
      args: [
        tokenAddr as `0x${string}`,
        totalBn,
        beneficiary as `0x${string}`,
        milestones.map(m => ({
          description:  m.description,
          evidenceUrl:  m.evidenceUrl,
          unlockAmount: parseEther(m.unlockAmount || '0'),
          deadline:     BigInt(Math.floor(new Date(m.deadline).getTime() / 1000)),
        })),
      ],
    })
  }

  const busy = isPending || confirming

  if (!address) return (
    <div className="card p-8 text-center text-zinc-400 text-sm">Connect your wallet to create a schedule</div>
  )

  return (
    <div className="card p-6 space-y-6 max-w-2xl">
      <h2 className="font-semibold text-zinc-100">Create Vesting Schedule</h2>

      <div className="space-y-4">
        <FormGroup label="Token Address">
          <input className="input font-mono text-xs" value={tokenAddr} onChange={e => setTokenAddr(e.target.value)} />
        </FormGroup>
        <div className="grid grid-cols-2 gap-3">
          <FormGroup label="Total Amount (tokens)">
            <input className="input" type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} />
          </FormGroup>
          <FormGroup label="Beneficiary Address">
            <input className="input font-mono text-xs" value={beneficiary} onChange={e => setBeneficiary(e.target.value)} />
          </FormGroup>
        </div>
      </div>

      {/* Milestones */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Milestones</p>
          <button className="btn-ghost text-xs flex items-center gap-1" onClick={addMilestone}>
            <Plus size={12} /> Add milestone
          </button>
        </div>
        {!amountMatch && milestones.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertTriangle size={12} />
            Milestone amounts ({totalMsAmount}) must sum to total ({totalAmount})
          </div>
        )}
        {milestones.map((m, i) => (
          <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Milestone {i + 1}</span>
              {milestones.length > 1 && (
                <button onClick={() => removeMilestone(i)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                  <XCircle size={14} />
                </button>
              )}
            </div>
            <FormGroup label="Milestone claim (used as the AI search query)">
              <input className="input" placeholder="e.g. Project X launched its mainnet and reached 10,000 users" value={m.description} onChange={e => updateMs(i, 'description', e.target.value)} />
            </FormGroup>
            <FormGroup label="Evidence domain (the AI searches this site for the claim)">
              <input className="input" placeholder="e.g. github.com  •  yourproject.com  •  ethereum.org" value={m.evidenceUrl} onChange={e => updateMs(i, 'evidenceUrl', e.target.value)} />
            </FormGroup>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Unlock Amount">
                <input className="input" type="number" value={m.unlockAmount} onChange={e => updateMs(i, 'unlockAmount', e.target.value)} />
              </FormGroup>
              <FormGroup label="Deadline">
                <input className="input" type="date" value={m.deadline} onChange={e => updateMs(i, 'deadline', e.target.value)} />
              </FormGroup>
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div>
        {needsApproval ? (
          <button className="btn-secondary w-full flex items-center justify-center gap-2" onClick={handleApprove} disabled={busy}>
            {busy && <RefreshCw size={12} className="animate-spin" />}
            Approve Token Transfer
          </button>
        ) : (
          <button
            className="btn-primary w-full flex items-center justify-center gap-2"
            onClick={handleCreate}
            disabled={busy || !amountMatch || milestones.some(m => !m.description || !m.evidenceUrl || !m.deadline)}
          >
            {busy && <RefreshCw size={12} className="animate-spin" />}
            Create Schedule
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

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-400 font-medium">{label}</label>
      {children}
    </div>
  )
}

