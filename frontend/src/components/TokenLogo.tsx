// Deterministic, refined "project logo" generated from a token address.
// Each token gets a distinct gradient brand mark + monogram — no external assets,
// always available, and the same address always renders the same logo.

export type Accent = {
  a: string        // gradient start
  b: string        // gradient end
  ring: string     // tailwind ring class
  text: string     // tailwind text accent
  dot: string      // tailwind bg accent
  wash: string     // tailwind gradient-from for card wash
  glow: string     // rgba for soft glow
}

// Muted, sophisticated palette — deep tones, not neon.
const ACCENTS: Accent[] = [
  { a: '#818cf8', b: '#4f46e5', ring: 'ring-indigo-400/30',  text: 'text-indigo-300',  dot: 'bg-indigo-400',  wash: 'from-indigo-500/20',  glow: 'rgba(99,102,241,0.35)' },
  { a: '#34d399', b: '#059669', ring: 'ring-emerald-400/30', text: 'text-emerald-300', dot: 'bg-emerald-400', wash: 'from-emerald-500/20', glow: 'rgba(16,185,129,0.35)' },
  { a: '#38bdf8', b: '#0284c7', ring: 'ring-sky-400/30',     text: 'text-sky-300',     dot: 'bg-sky-400',     wash: 'from-sky-500/20',     glow: 'rgba(14,165,233,0.35)' },
  { a: '#fbbf24', b: '#d97706', ring: 'ring-amber-400/30',   text: 'text-amber-300',   dot: 'bg-amber-400',   wash: 'from-amber-500/20',   glow: 'rgba(245,158,11,0.35)' },
  { a: '#fb7185', b: '#e11d48', ring: 'ring-rose-400/30',    text: 'text-rose-300',    dot: 'bg-rose-400',    wash: 'from-rose-500/20',    glow: 'rgba(244,63,94,0.35)' },
  { a: '#a78bfa', b: '#7c3aed', ring: 'ring-violet-400/30',  text: 'text-violet-300',  dot: 'bg-violet-400',  wash: 'from-violet-500/20',  glow: 'rgba(139,92,246,0.35)' },
  { a: '#2dd4bf', b: '#0d9488', ring: 'ring-teal-400/30',    text: 'text-teal-300',    dot: 'bg-teal-400',    wash: 'from-teal-500/20',    glow: 'rgba(20,184,166,0.35)' },
  { a: '#f472b6', b: '#db2777', ring: 'ring-pink-400/30',    text: 'text-pink-300',    dot: 'bg-pink-400',    wash: 'from-pink-500/20',    glow: 'rgba(236,72,153,0.35)' },
]

export function accentFor(addr?: string): Accent {
  if (!addr) return ACCENTS[0]
  return ACCENTS[parseInt(addr.slice(2, 4), 16) % ACCENTS.length]
}

const byte = (addr: string, i: number) => parseInt(addr.slice(2 + i * 2, 4 + i * 2) || '0', 16)

export function TokenLogo({
  address, symbol, size = 64, rounded = 0.28,
}: { address?: string; symbol?: string; size?: number; rounded?: number }) {
  const accent = accentFor(address)
  const addr = address ?? '0x00000000000000000000'
  const id = addr.slice(2, 10)
  const r = size * rounded

  // ── Generative geometric mark (a small "node constellation") ──
  const cx = size / 2, cy = size / 2
  const count = 3 + (byte(addr, 0) % 4)            // 3–6 nodes
  const base = (byte(addr, 1) / 255) * Math.PI * 2 // rotation
  const radius = size * 0.255
  const ring = byte(addr, 3) % 2 === 0             // sometimes an orbit ring
  const sw = Math.max(1, size * 0.028)
  const sat = Array.from({ length: count }, (_, i) => {
    const a = base + (i * Math.PI * 2) / count
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <defs>
        <linearGradient id={`g-${id}`} gradientTransform={`rotate(${byte(addr, 2)} 0.5 0.5)`}>
          <stop offset="0%" stopColor={accent.a} />
          <stop offset="100%" stopColor={accent.b} />
        </linearGradient>
        <radialGradient id={`h-${id}`} cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={size} height={size} rx={r} fill={`url(#g-${id})`} />
      <rect width={size} height={size} rx={r} fill={`url(#h-${id})`} />
      <rect x="0.5" y="0.5" width={size - 1} height={size - 1} rx={r} fill="none" stroke="#ffffff" strokeOpacity="0.12" />

      <g stroke="#ffffff" strokeOpacity="0.9" strokeWidth={sw} strokeLinecap="round">
        {ring && <circle cx={cx} cy={cy} r={radius} fill="none" strokeOpacity="0.22" />}
        {sat.map((s, i) => (
          <line key={i} x1={cx} y1={cy} x2={s.x} y2={s.y} strokeOpacity="0.55" />
        ))}
      </g>
      <g fill="#ffffff">
        {sat.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={size * 0.052} fillOpacity="0.95" />
        ))}
        <circle cx={cx} cy={cy} r={size * 0.082} />
      </g>
    </svg>
  )
}
