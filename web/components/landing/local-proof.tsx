import { CheckIcon, FileIcon, GlobeIcon, ShieldIcon } from '@/components/icons';

// Hero proof of "fully local": the path a file takes is drawn inside a "This computer" boundary, and the
// cloud side reads 0 bytes. True for the default setup (server analysis is opt-in), so keep it in step with
// docs/TRUSTCODE_TRUST_AND_PRIVACY.md.
const STEPS: [typeof FileIcon, string, string][] = [
  [FileIcon, 'Your code', 'from-[#4F7BFF] to-[#A97CFF]'],
  [ShieldIcon, 'Checked', 'from-[#38E1FF] to-[#4F7BFF]'],
  [CheckIcon, 'Results', 'from-[#2EE6A6] to-[#38E1FF]'],
];

export function LocalProof() {
  return (
    <figure className="mt-9 grid max-w-xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <figcaption className="sr-only">Your code is checked and the results are shown on your computer. Nothing is uploaded: 0 bytes of your code leave the machine.</figcaption>
      <div aria-hidden="true" className="relative rounded-2xl border border-ok/30 bg-ok/[.04] px-4 pb-4 pt-7">
        <span className="absolute -top-2.5 left-4 rounded-full border border-ok/40 bg-bg px-2.5 text-xs font-medium text-ok">This computer</span>
        <ol className="flex items-center">
          {STEPS.map(([I, label, grad], i) => (
            <li key={label} className="contents">
              {i > 0 && <span className="mx-2 h-[2px] min-w-4 flex-1 rounded-full"><span className="beam block h-full w-full rounded-full" style={{ animationDelay: `${i * 0.6}s` }} /></span>}
              <span className="flex flex-col items-center gap-1.5">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${grad} shadow-[0_0_24px_-6px_rgba(56,225,255,.7)]`}>
                  <I className="h-5 w-5 text-white" />
                </span>
                <span className="text-xs text-muted">{label}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 sm:flex-col sm:items-start sm:justify-center sm:gap-0.5">
        <span aria-hidden="true" className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-line2 text-dim sm:hidden">
          <GlobeIcon className="h-5 w-5" /><span className="absolute h-[2px] w-7 rotate-45 rounded bg-dim" />
        </span>
        <p className="font-mono text-2xl font-semibold leading-none tabular-nums text-fg" aria-hidden="true">0 bytes</p>
        <p className="text-xs text-muted" aria-hidden="true">of your code uploaded</p>
      </div>
    </figure>
  );
}
