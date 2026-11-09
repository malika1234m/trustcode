import { LogoMark } from '@/components/logo';
import { AlertIcon, CheckIcon, MinusIcon } from '@/components/icons';

/** "A confidence score" vs "TrustCode evidence", shown as two small product-like visuals. */
export function Versus() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <figure className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-line bg-bg2 p-10">
        <div className="relative h-40 w-40" aria-hidden="true">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--dim)" strokeWidth="10" strokeDasharray="314" strokeDashoffset="25" strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-muted">92%</span>
        </div>
        <figcaption className="mt-6 text-center"><span className="block text-lg font-semibold text-muted">A confidence score</span><span className="text-sm text-dim">Which line? Which check? Unknown.</span></figcaption>
      </figure>
      <figure className="rounded-2xl border border-brand/50 bg-card p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold"><LogoMark className="h-5 w-5" />TrustCode evidence</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2.5 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2.5"><AlertIcon className="h-4 w-4 text-warn" />SQL injection<span className="ml-auto font-mono text-xs text-muted">line 4 · CWE-89</span></li>
          <li className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5"><CheckIcon className="h-4 w-4 text-ok" />Syntax, lint, dependencies<span className="ml-auto text-xs text-muted">no findings</span></li>
          <li className="flex items-center gap-2.5 rounded-lg border border-dashed border-line2 px-3 py-2.5"><MinusIcon className="h-4 w-4 text-dim" />Runtime behaviour<span className="hatch ml-auto rounded px-2 py-0.5 text-xs text-muted">not verified</span></li>
        </ul>
        <figcaption className="mt-4 text-sm text-dim">Every finding has a source. Every gap is shown.</figcaption>
      </figure>
    </div>
  );
}
