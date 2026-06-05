import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Bot, Sparkles, ShieldCheck, GitBranch, Zap,
  Activity, Lock, Coins, Cpu, Layers,
} from 'lucide-react'
import { VeraMark } from '../components/Logo'

export default function Home() {
  return (
    <div className="space-y-28 pb-16">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center pt-6">
        <div style={{ animation: 'fadeUp .55s ease both' }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="eyebrow !tracking-[0.14em]">Live on Somnia Agentic L1</span>
          </div>

          <h1 className="display text-5xl sm:text-6xl font-bold text-zinc-50 leading-[1.02]">
            The launchpad
            <span className="block">that <span className="text-indigo-400">runs itself.</span></span>
          </h1>

          <p className="mt-6 text-lg text-zinc-400 leading-relaxed max-w-lg">
            On-chain AI makes every decision — verifying real humans, vetting projects, and releasing
            funds only when milestones actually ship. A keeper agent operates the protocol with
            <span className="text-zinc-200"> no admin in the loop.</span>
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/discover" className="btn-primary px-5 py-3 text-[15px]">
              Explore launches <ArrowRight size={16} />
            </Link>
            <Link to="/agents" className="btn-secondary px-5 py-3 text-[15px]">
              <Activity size={15} /> Watch the agents
            </Link>
          </div>

          <div className="mt-10 flex items-center gap-6 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><Cpu size={13} className="text-zinc-400" /> 4 on-chain AI agents</span>
            <span className="flex items-center gap-1.5"><Lock size={13} className="text-zinc-400" /> Non-custodial</span>
            <span className="flex items-center gap-1.5"><Bot size={13} className="text-zinc-400" /> 0 admins</span>
          </div>
        </div>

        <div style={{ animation: 'fadeUp .65s ease .1s both' }}>
          <AgentGraph />
        </div>
      </section>

      {/* ── Stat strip ───────────────────────────────────────────────────── */}
      <Reveal>
        <section className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 divide-x divide-y md:divide-y-0 divide-zinc-800 overflow-hidden">
          <Stat value={4}  suffix=""  label="AI agents deciding" />
          <Stat value={100} suffix="%" label="On-chain & non-custodial" />
          <Stat value={0}  suffix=""  label="Admin keys" />
          <Stat value={90} suffix="d" label="Reusable Sybil scores" />
        </section>
      </Reveal>

      {/* ── Bento features ───────────────────────────────────────────────── */}
      <Reveal>
        <section>
          <SectionHead eyebrow="Why it's different" title="Fairness, enforced by AI — on both sides of the launch." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Bento className="md:col-span-2 md:row-span-2" highlight>
              <div className="flex items-start justify-between">
                <Glyph icon={<Coins size={20} />} highlight />
                <span className="badge-verified">Flagship</span>
              </div>
              <h3 className="display text-xl font-semibold text-zinc-50 mt-5">Milestone-gated treasury</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-md">
                The raise isn't handed to the team on day one. It's escrowed and released in tranches
                only as the AI verifies real milestones from public evidence. If a team ghosts,
                investors claw back the rest.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-2">
                {[
                  { k: 'Verified', v: 'AI PASS' },
                  { k: 'Released', v: '1.2 STT' },
                  { k: 'Clawback', v: '0.8 STT' },
                ].map(s => (
                  <div key={s.k} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
                    <p className="eyebrow !text-[10px]">{s.k}</p>
                    <p className="stat-num text-sm font-semibold mt-1 text-zinc-200">{s.v}</p>
                  </div>
                ))}
              </div>
            </Bento>

            <Bento>
              <Glyph icon={<Zap size={18} />} />
              <h3 className="display text-base font-semibold text-zinc-50 mt-4">Swipe to invest</h3>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                A swipe-style feed built for small retail — browse launches and back one in two taps.
              </p>
              <Link to="/discover" className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
                Open Discover <ArrowRight size={12} />
              </Link>
            </Bento>

            <Bento>
              <Glyph icon={<ShieldCheck size={18} />} />
              <h3 className="display text-base font-semibold text-zinc-50 mt-4">AI Sybil gate</h3>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                A multi-signal score (activity + real capital) keeps bot armies out, so per-wallet caps mean per-human.
              </p>
            </Bento>

            <Bento>
              <Glyph icon={<Sparkles size={18} />} />
              <h3 className="display text-base font-semibold text-zinc-50 mt-4">Project trust score</h3>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                An LLM agent rates each project's legitimacy 0–100 from its site — a trust signal on every card.
              </p>
            </Bento>

            <Bento className="md:col-span-2">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Glyph icon={<Bot size={18} />} />
                  <div>
                    <h3 className="display text-base font-semibold text-zinc-50">The autonomous keeper</h3>
                    <p className="text-sm text-zinc-400 mt-0.5">Finalizes sales, invokes the AI, scores projects — unattended.</p>
                  </div>
                </div>
                <Link to="/agents" className="btn-ghost text-xs shrink-0">See it live →</Link>
              </div>
            </Bento>
          </div>
        </section>
      </Reveal>

      {/* ── Agent pipeline ───────────────────────────────────────────────── */}
      <Reveal>
        <section>
          <SectionHead eyebrow="How the AI works" title="Four agents, every decision on-chain." />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <AgentCard icon={<ShieldCheck size={18} />} name="Sybil score" sub="JSON API agent" body="Reads a wallet's tx count + STT balance and scores its humanness 0–100." />
            <AgentCard icon={<Sparkles size={18} />} name="Project trust" sub="Parse + LLM" body="Scrapes a project's site and rates legitimacy for buyers." />
            <AgentCard icon={<GitBranch size={18} />} name="Milestone verifier" sub="Parse + LLM" body="Confirms real-world milestones, then releases escrow or vests tokens." />
            <AgentCard icon={<Bot size={18} />} name="Keeper" sub="Operator agent" body="Discovers state and invokes the others — runs the protocol itself." />
          </div>
        </section>
      </Reveal>

      {/* ── USP banner ───────────────────────────────────────────────────── */}
      <Reveal>
        <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50 p-10 sm:p-14 text-center">
          <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-indigo-600/[0.07] blur-3xl pointer-events-none" />
          <div className="relative">
            <p className="eyebrow">No team, no trust required</p>
            <h2 className="display text-3xl sm:text-4xl font-bold text-zinc-50 mt-3 max-w-2xl mx-auto leading-tight">
              A launch where the AI guards the money — not a promise.
            </h2>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/discover" className="btn-primary px-5 py-3 text-[15px]">Start exploring <ArrowRight size={16} /></Link>
              <Link to="/registry" className="btn-secondary px-5 py-3 text-[15px]">Get your Sybil score</Link>
            </div>
          </div>
        </section>
      </Reveal>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <VeraMark size={24} className="rounded-lg" />
          <span className="text-sm text-zinc-400">VeraLaunch — autonomous AI launchpad on Somnia</span>
        </div>
        <div className="flex items-center gap-5 text-xs text-zinc-500">
          <Link to="/discover" className="hover:text-zinc-300">Discover</Link>
          <Link to="/agents" className="hover:text-zinc-300">Agents</Link>
          <a href="/.well-known/agent.json" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 flex items-center gap-1">
            <Layers size={12} /> Agent manifest
          </a>
        </div>
      </footer>
    </div>
  )
}

/* ── Unique animated hero: autonomous agent-orchestration graph ─────────── */
function AgentGraph() {
  // node positions in a 0..100 square (kept round by a square container)
  const core = { x: 50, y: 50 }
  const nodes = [
    { x: 17, y: 19, icon: <ShieldCheck size={15} />, label: 'Sybil' },
    { x: 83, y: 19, icon: <Sparkles size={15} />,    label: 'Trust' },
    { x: 17, y: 81, icon: <GitBranch size={15} />,   label: 'Milestone' },
    { x: 83, y: 81, icon: <Bot size={15} />,         label: 'Keeper' },
  ]
  return (
    <div className="relative mx-auto w-full max-w-[440px] aspect-square">
      {/* soft single-accent glow */}
      <div className="absolute inset-10 rounded-full bg-indigo-600/[0.06] blur-3xl" />

      {/* connectors + flowing pulses */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        {nodes.map((n, i) => {
          const d = `M ${core.x} ${core.y} L ${n.x} ${n.y}`
          return (
            <g key={i}>
              <path d={d} stroke="#27272a" strokeWidth="0.5" fill="none" />
              {/* invocation pulse: core → agent */}
              <circle r="0.9" fill="#818cf8">
                <animateMotion dur="2.6s" begin={`${i * 0.55}s`} repeatCount="indefinite" path={d} />
                <animate attributeName="opacity" values="0;1;1;0" dur="2.6s" begin={`${i * 0.55}s`} repeatCount="indefinite" />
              </circle>
              {/* result pulse: agent → core */}
              <circle r="0.7" fill="#52525b">
                <animateMotion dur="2.6s" begin={`${i * 0.55 + 1.3}s`} repeatCount="indefinite" path={`M ${n.x} ${n.y} L ${core.x} ${core.y}`} />
                <animate attributeName="opacity" values="0;1;1;0" dur="2.6s" begin={`${i * 0.55 + 1.3}s`} repeatCount="indefinite" />
              </circle>
            </g>
          )
        })}
      </svg>

      {/* agent nodes */}
      {nodes.map((n, i) => (
        <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5"
          style={{ left: `${n.x}%`, top: `${n.y}%`, animation: `fadeUp .5s ease ${0.25 + i * 0.1}s both` }}>
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center justify-center shadow-lg shadow-black/30">
            {n.icon}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{n.label}</span>
        </div>
      ))}

      {/* core */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
        <div className="relative">
          <span className="absolute -inset-1 rounded-[18px] border border-indigo-500/40 animate-ping" style={{ animationDuration: '2.4s' }} />
          <VeraMark size={60} className="relative rounded-2xl shadow-xl shadow-indigo-900/40" />
        </div>
      </div>

      {/* live label */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[10px] text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
        <span className="font-mono uppercase tracking-wider">autonomous · operating</span>
      </div>
    </div>
  )
}

/* ── Scroll reveal ─────────────────────────────────────────────────────── */
function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ animation: shown ? 'fadeUp .6s ease both' : undefined, opacity: shown ? undefined : 0 }}>
      {children}
    </div>
  )
}

/* ── Primitives ────────────────────────────────────────────────────────── */
function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const n = useCountUp(value)
  return (
    <div className="px-5 py-6">
      <p className="stat-num text-3xl font-bold text-zinc-50">{n}{suffix}</p>
      <p className="text-xs text-zinc-500 mt-1">{label}</p>
    </div>
  )
}

function useCountUp(target: number, ms = 900) {
  const [val, setVal] = useState(0)
  const [start, setStart] = useState(false)
  useEffect(() => {
    if (!start) { const t = setTimeout(() => setStart(true), 200); return () => clearTimeout(t) }
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [start, target, ms])
  return val
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display text-2xl sm:text-3xl font-bold text-zinc-50 mt-2 leading-tight">{title}</h2>
    </div>
  )
}

function Glyph({ icon, highlight }: { icon: React.ReactNode; highlight?: boolean }) {
  return (
    <span className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
      highlight ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-300'
    }`}>{icon}</span>
  )
}

function Bento({ children, className = '', highlight }: { children: React.ReactNode; className?: string; highlight?: boolean }) {
  return (
    <div className={`card p-6 relative overflow-hidden hover:border-zinc-700 transition-colors ${className}`}>
      {highlight && <div className="absolute -top-20 -right-20 w-44 h-44 rounded-full bg-indigo-600/[0.08] blur-3xl" />}
      <div className="relative">{children}</div>
    </div>
  )
}

function AgentCard({ icon, name, sub, body }: { icon: React.ReactNode; name: string; sub: string; body: string }) {
  return (
    <div className="card p-5 hover:border-zinc-700 transition-colors">
      <Glyph icon={icon} />
      <h3 className="display text-base font-semibold text-zinc-50 mt-4">{name}</h3>
      <p className="eyebrow !text-[10px] mt-0.5">{sub}</p>
      <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{body}</p>
    </div>
  )
}
