import { LogoMark } from '@/components/logo';

// Illustration: several AI coding agents write into one project; TrustCode sits in the middle as an independent
// check on every change. Names are plain text (no logos), and no integration is implied.
const AGENTS: { name: string; x: number; y: number }[] = [
  { name: 'Codex', x: 12, y: 18 }, { name: 'Claude Code', x: 50, y: 6 }, { name: 'Cursor', x: 88, y: 18 },
  { name: 'Antigravity', x: 12, y: 82 }, { name: 'Copilot', x: 50, y: 94 }, { name: 'DeepSeek', x: 88, y: 82 },
];

export function AgentHub() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-4xl">
      {/* Orbit layout (tablet and up) */}
      <div className="relative hidden aspect-[2/1] sm:block">
        <svg viewBox="0 0 1000 500" className="absolute inset-0 h-full w-full" fill="none" preserveAspectRatio="none">
          <defs>
            <radialGradient id="hub-glow"><stop stopColor="#5B8CFF" stopOpacity=".45" /><stop offset="1" stopColor="#5B8CFF" stopOpacity="0" /></radialGradient>
          </defs>
          <ellipse cx="500" cy="250" rx="300" ry="190" fill="url(#hub-glow)" />
          <ellipse cx="500" cy="250" rx="420" ry="215" stroke="rgba(142,150,255,.14)" />
          <ellipse cx="500" cy="250" rx="250" ry="140" stroke="rgba(56,225,255,.12)" />
          {AGENTS.map((a) => {
            const x = a.x * 10, y = a.y * 5;
            const cx = (x + 500) / 2, cy = y < 250 ? y + 70 : y - 70;
            return <path key={a.name} d={`M${x} ${y} Q${cx} ${cy} 500 250`} stroke="rgba(56,225,255,.55)" strokeWidth="1.6" className="flow" vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {AGENTS.map((a) => (
          <span key={a.name} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl border border-white/10 bg-[#111A2E]/90 px-4 py-2 text-sm font-medium text-fg shadow-[0_10px_30px_-12px_rgba(0,0,0,.8)] backdrop-blur"
                style={{ left: `${a.x}%`, top: `${a.y}%` }}>
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[var(--neon-purple)] align-middle" />{a.name}
          </span>
        ))}
        <Core id="d" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Stacked layout (phones) */}
      <div className="flex flex-col items-center gap-6 sm:hidden">
        <div className="flex flex-wrap justify-center gap-2">
          {AGENTS.map((a) => <span key={a.name} className="rounded-lg border border-white/10 bg-[#111A2E]/90 px-3 py-1.5 text-sm">{a.name}</span>)}
        </div>
        <svg viewBox="0 0 40 60" className="h-12 w-8" fill="none"><path d="M20 0v60" stroke="url(#m-line)" strokeWidth="2" className="flow" /><defs><linearGradient id="m-line" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#A97CFF" stopOpacity=".2" /><stop offset="1" stopColor="#38E1FF" /></linearGradient></defs></svg>
        <Core id="m" />
      </div>
    </div>
  );
}

function Core({ id, className = '' }: { id: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="relative flex h-32 w-32 items-center justify-center">
        <span className="pulse-soft absolute inset-0 rounded-full border border-[var(--neon-cyan)]/40" />
        <span className="absolute inset-3 rounded-full bg-[radial-gradient(circle,rgba(91,140,255,.35),transparent_70%)]" />
        <svg viewBox="0 0 100 110" className="glow-purple absolute h-28 w-28" fill="none">
          <path d="M50 4 90 18v34c0 26-17 44-40 54C27 96 10 78 10 52V18Z" fill={`url(#core-fill-${id})`} stroke={`url(#core-stroke-${id})`} strokeWidth="2.5" />
          <defs>
            <linearGradient id={`core-fill-${id}`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#1B2A55" /><stop offset="1" stopColor="#0C1322" /></linearGradient>
            <linearGradient id={`core-stroke-${id}`} x1="0" x2="1"><stop stopColor="#5B8CFF" /><stop offset="1" stopColor="#A97CFF" /></linearGradient>
          </defs>
        </svg>
        <LogoMark className="relative h-12 w-12" />
      </div>
      <span className="mt-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-[#C8CCFF]">TrustCode</span>
    </div>
  );
}
