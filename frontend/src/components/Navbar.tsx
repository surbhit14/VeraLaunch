import { NavLink } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect, useSwitchChain, useBalance } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatEther } from 'viem'
import { Compass, Rocket, GitBranch, ShieldCheck, Activity } from 'lucide-react'
import { somniaTestnet } from '../chain'
import { VeraMark } from './Logo'

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

const NAV = [
  { to: '/discover',  label: 'Discover',  icon: Compass },
  { to: '/launchpad', label: 'Launchpad', icon: Rocket },
  { to: '/vesting',   label: 'Vesting',   icon: GitBranch },
  { to: '/registry',  label: 'Registry',  icon: ShieldCheck },
  { to: '/agents',    label: 'Agents',    icon: Activity },
]

export default function Navbar() {
  const { address, isConnected, chain } = useAccount()
  const { connect, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { data: balance } = useBalance({ address, query: { enabled: !!address } })

  const wrongChain = isConnected && chain?.id !== somniaTestnet.id

  const deskCls = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm transition-colors after:absolute after:-bottom-[19px] after:left-0 after:h-px after:bg-indigo-400 after:transition-all ${
      isActive ? 'text-zinc-100 font-medium after:w-full' : 'text-zinc-400 hover:text-zinc-100 after:w-0 hover:after:w-full'
    }`

  return (
    <>
      {/* Top bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2.5 sm:mr-8 group">
            <VeraMark size={28} className="shadow-lg shadow-indigo-600/30 rounded-[9px] group-hover:shadow-indigo-500/40 transition-shadow" />
            <span className="display font-bold text-zinc-100 tracking-tightest text-[15px]">VeraLaunch</span>
          </NavLink>

          {/* desktop nav */}
          <nav className="hidden md:flex items-center gap-6 flex-1">
            {NAV.map(n => <NavLink key={n.to} to={n.to} className={deskCls}>{n.label}</NavLink>)}
          </nav>

          {/* wallet */}
          <div className="flex items-center gap-3">
            {!isConnected ? (
              <button className="btn-primary !py-2" onClick={() => connect({ connector: injected() })} disabled={isConnecting}>
                {isConnecting ? 'Connecting…' : <><span className="hidden sm:inline">Connect Wallet</span><span className="sm:hidden">Connect</span></>}
              </button>
            ) : wrongChain ? (
              <button
                className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm px-3 sm:px-4 py-2 rounded-lg hover:bg-amber-500/20 transition-colors"
                onClick={() => switchChain({ chainId: somniaTestnet.id })}>
                Switch<span className="hidden sm:inline"> to Somnia</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-xs text-zinc-400 stat-num">
                  {balance ? `${parseFloat(formatEther(balance.value)).toFixed(2)} STT` : '—'}
                </span>
                <button onClick={() => disconnect()}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm px-3 py-1.5 rounded-lg transition-colors font-mono">
                  {shortAddr(address!)}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}>
              {({ isActive }) => (
                <>
                  <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
