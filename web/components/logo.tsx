// The TrustCode mark: a selection frame (two corner brackets) around a check whose long stroke breaks up and fades.
// It says "verified up to a point, and the gaps are shown". Colours follow --frame / --check, so it adapts to theme.
// Static assets for other uses live in /public/brand (see DESIGN.md).
export function LogoMark({ className = 'h-7 w-7', mono = false }: { className?: string; mono?: boolean }) {
  const frame = mono ? 'currentColor' : 'var(--frame)';
  const check = mono ? 'currentColor' : 'var(--check)';
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path d="M6 17V10a4 4 0 0 1 4-4h7M42 31v7a4 4 0 0 1-4 4h-7" fill="none" stroke={frame} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 25l7 7 6.3-7.65" fill="none" stroke={check} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29.2 21.9l2.3-2.8" fill="none" stroke={check} strokeWidth="4.5" strokeOpacity=".55" />
      <path d="M33.4 16.8l1.6-1.95" fill="none" stroke={check} strokeWidth="4.5" strokeOpacity=".28" />
    </svg>
  );
}

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: ['h-6 w-6', 'text-[0.98rem]'], md: ['h-7 w-7', 'text-[1.08rem]'], lg: ['h-10 w-10', 'text-2xl'] }[size];
  return (
    <span className="flex items-center gap-2 font-semibold tracking-[-0.01em] text-fg">
      <LogoMark className={s[0]} /><span className={s[1]}>TrustCode</span>
    </span>
  );
}
