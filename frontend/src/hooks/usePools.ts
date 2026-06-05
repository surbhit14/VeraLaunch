import { useState, useEffect, useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { ADDRESSES, LAUNCH_POOL_ABI } from '../contracts'

export type Pool = {
  id: number
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
  finalizedAt: bigint
  buyerCliff: bigint
  buyerVest: bigint
  usesTreasury: boolean
  treasuryReleased: bigint
}

export type PoolStatus = 'upcoming' | 'live' | 'ended' | 'finalized'

export function poolStatus(p: Pool, now = BigInt(Math.floor(Date.now() / 1000))): PoolStatus {
  if (p.finalized) return 'finalized'
  if (now < p.startTime) return 'upcoming'
  if (now > p.endTime)   return 'ended'
  return 'live'
}

// viem may return named-object OR positional-array depending on version/wrapper.
const g = (d: any, name: string, idx: number) => (d?.[name] !== undefined ? d[name] : d?.[idx])

/** Loads every pool from LaunchPool, polling to stay live. */
export function usePools(refetchInterval = 20_000) {
  const { data: nextId } = useReadContract({
    address: ADDRESSES.LaunchPool,
    abi: LAUNCH_POOL_ABI,
    functionName: 'nextPoolId',
  })

  const poolCount = nextId ? Number(nextId) : 0

  const poolContracts = useMemo(
    () =>
      Array.from({ length: poolCount }, (_, i) => ({
        address: ADDRESSES.LaunchPool,
        abi: LAUNCH_POOL_ABI,
        functionName: 'pools' as const,
        args: [BigInt(i)] as const,
      })),
    [poolCount],
  )

  const { data: poolResults, refetch, isLoading } = useReadContracts({
    contracts: poolContracts,
    query: { refetchInterval },
  })

  const pools: Pool[] = (poolResults ?? [])
    .map((r: any, i: number) => {
      if (r.status !== 'success' || !r.result) return null
      const d = r.result as any
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
        finalizedAt:      g(d, 'finalizedAt',      12) as bigint,
        buyerCliff:       g(d, 'buyerCliff',       13) as bigint,
        buyerVest:        g(d, 'buyerVest',        14) as bigint,
        usesTreasury:     Boolean(g(d, 'usesTreasury', 15)),
        treasuryReleased: g(d, 'treasuryReleased', 16) as bigint,
      }
    })
    .filter(Boolean) as Pool[]

  return { pools, poolCount, refetch, isLoading }
}

export function useCountdown(target: bigint) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const update = () => {
      const diff = Number(target) - Math.floor(Date.now() / 1000)
      if (diff <= 0) { setLabel('Ended'); return }
      const d = Math.floor(diff / 86400)
      const h = Math.floor((diff % 86400) / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setLabel(d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [target])
  return label
}
