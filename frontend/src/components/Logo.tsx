// VeraLaunch brand mark — a geometric "ascend / verify" double-chevron on an
// indigo squircle. Used in the navbar, homepage core, and footer.

export function VeraMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="VeraLaunch">
      <defs>
        <linearGradient id="vera-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
        <radialGradient id="vera-h" cx="30%" cy="24%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#vera-g)" />
      <rect width="32" height="32" rx="9" fill="url(#vera-h)" />
      <rect x="0.6" y="0.6" width="30.8" height="30.8" rx="8.6" fill="none" stroke="#ffffff" strokeOpacity="0.14" />
      <path d="M9 17 L16 10 L23 17" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 23 L16 16 L23 23" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.55" />
    </svg>
  )
}
