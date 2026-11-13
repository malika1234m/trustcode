import { CodeIcon, ServerIcon, ShieldIcon } from '@/components/icons';

// Architecture as of extension 1.0.0 (docs/TRUSTCODE_TRUST_AND_PRIVACY.md): the VS Code extension talks to a local
// engine on the same machine. The TrustCode server is an optional side branch, drawn dashed.
const TOOLS = ['Security rules', 'Secret detection', 'Code checks', 'Type checks', 'Dependency checks'];

export function Architecture() {
  return (
    <figure className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_5rem_15rem] lg:gap-0">
      <figcaption className="sr-only">
        The TrustCode extension in VS Code sends code to the local engine on the same computer, which runs security rules, secret detection,
        code, type and dependency checks. Results stay on the computer. A TrustCode server is optional, used only for an account or server analysis.
      </figcaption>

      {/* Your computer */}
      <div className="neon-frame relative rounded-[22px] p-5 pt-12 sm:p-7 sm:pt-14">
        <span className="absolute left-5 top-4 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs font-semibold text-ok sm:left-7">Your computer</span>
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1.35fr)] sm:gap-0">
          <div className="rounded-2xl border border-white/10 bg-[#0F1830] p-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#4F7BFF] to-[#A97CFF] shadow-[0_0_30px_-6px_rgba(120,110,255,.8)]"><CodeIcon className="h-6 w-6 text-white" /></span>
            <p className="mt-3 font-semibold">VS Code extension</p>
            <p className="text-sm text-muted">Security, Verify, Session</p>
          </div>
          <span aria-hidden="true" className="mx-auto block h-8 w-[2px] sm:h-[2px] sm:w-full"><span className="beam block h-full w-full rounded-full" /></span>
          <div className="rounded-2xl border border-[var(--neon-cyan)]/30 bg-[#0F1830] p-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#38E1FF] to-[#4F7BFF] shadow-[0_0_30px_-6px_rgba(56,225,255,.8)]"><ShieldIcon className="h-6 w-6 text-white" /></span>
            <p className="mt-3 font-semibold">Local engine</p>
            <ul className="mt-2 flex flex-wrap justify-center gap-1.5">
              {TOOLS.map((t) => <li key={t} className="rounded-md border border-white/10 bg-white/[.03] px-2 py-0.5 text-xs text-muted">{t}</li>)}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-center text-sm text-muted">Code, results and history stay here.</p>
      </div>

      {/* Optional branch */}
      <span aria-hidden="true" className="mx-auto block h-10 w-0 border-l-2 border-dashed border-line2 lg:h-0 lg:w-full lg:border-l-0 lg:border-t-2" />
      <div className="rounded-[18px] border-2 border-dashed border-line2 p-5 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line2 text-dim"><ServerIcon className="h-5 w-5" /></span>
        <p className="mt-3 font-semibold text-muted">TrustCode server</p>
        <p className="text-sm text-dim">optional: account and server analysis</p>
      </div>
    </figure>
  );
}
