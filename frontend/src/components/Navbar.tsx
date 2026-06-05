import { NavLink } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect, useSwitchChain, useBalance } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatEther } from 'viem'
import { somniaTestnet } from '../chain'
import { VeraMark } from './Logo'

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function Navbar() {
  const { address, isConnected, chain } = useAccount()
  const { connect, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { data: balance } = useBalance({ address, query: { enabled: !!address } })

  const wrongChain = isConnected && chain?.id !== somniaTestnet.id

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm transition-colors after:absolute after:-bottom-[19px] after:left-0 after:h-px after:bg-indigo-400 after:transition-all ${
      isActive
        ? 'text-zinc-100 font-medium after:w-full'
        : 'text-zinc-400 hover:text-zinc-100 after:w-0 hover:after:w-full'
    }`

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 mr-8 group">
          <VeraMark size={28} className="shadow-lg shadow-indigo-600/30 rounded-[9px] group-hover:shadow-indigo-500/40 transition-shadow" />
          <span className="display font-bold text-zinc-100 tracking-tightest text-[15px]">VeraLaunch</span>
        </NavLink>

        {/* Nav links */}
        <nav className="flex items-center gap-6 flex-1">
          <NavLink to="/discover"  className={navCls}>Discover</NavLink>
          <NavLink to="/launchpad" className={navCls}>Launchpad</NavLink>
          <NavLink to="/vesting"   className={navCls}>Vesting</NavLink>
          <NavLink to="/registry"  className={navCls}>Registry</NavLink>
          <NavLink to="/agents"    className={navCls}>Agents</NavLink>
        </nav>

        {/* Wallet */}
        <div className="flex items-center gap-3">
          {!isConnected ? (
            <button
              className="btn-primary"
              onClick={() => connect({ connector: injected() })}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          ) : wrongChain ? (
            <button
              className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm px-4 py-2 rounded-lg hover:bg-amber-500/20 transition-colors"
              onClick={() => switchChain({ chainId: somniaTestnet.id })}
            >
              Switch to Somnia
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs text-zinc-400">
                  {balance ? `${parseFloat(formatEther(balance.value)).toFixed(2)} STT` : '—'}
                </span>
              </div>
              <button
                onClick={() => disconnect()}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm px-3 py-1.5 rounded-lg transition-colors font-mono"
              >
                {shortAddr(address!)}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
