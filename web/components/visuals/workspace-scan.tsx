import { FileIcon, FolderIcon } from '@/components/icons';

// Illustration: a whole workspace under review. Files are tiles; a scan beam sweeps across them, new and modified
// files are outlined, and files with findings light up. Fixed demonstration data, purely visual (aria-hidden).
type Tile = 'plain' | 'new' | 'mod' | 'err' | 'warn' | 'info' | 'skip';
// 7 rows x 14 columns on wide screens (the first 70 on phones, 10 per row).
const FLAGS: Record<number, Tile> = { 2: 'mod', 6: 'new', 11: 'warn', 16: 'mod', 18: 'skip', 23: 'new', 26: 'info', 29: 'mod', 33: 'mod',
  35: 'err', 42: 'new', 47: 'mod', 49: 'skip', 54: 'new', 58: 'mod', 63: 'warn', 67: 'mod', 72: 'new', 77: 'skip', 81: 'mod', 86: 'new', 90: 'mod', 95: 'info' };
const PATTERN: Tile[] = Array.from({ length: 98 }, (_, i) => FLAGS[i] ?? 'plain');
const STYLE: Record<Tile, string> = {
  plain: 'border-white/[.06] bg-white/[.025] text-dim',
  new: 'border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]',
  mod: 'border-warn/50 bg-warn/[.07] text-warn',
  err: 'border-err/70 bg-err/20 text-err shadow-[0_0_24px_-4px_var(--err)]',
  warn: 'border-warn/70 bg-warn/20 text-warn shadow-[0_0_24px_-6px_var(--warn)]',
  info: 'border-info/70 bg-info/20 text-info shadow-[0_0_24px_-6px_var(--info)]',
  skip: 'border-dashed border-line2 text-dim',
};
const TREE: [string, number, boolean?, string?][] = [
  ['src', 0, true], ['api', 1, true], ['users.ts', 2, false, 'warn'], ['orders.ts', 2, false, 'mod'], ['auth', 1, true],
  ['session.ts', 2, false, 'info'], ['jobs', 1, true], ['export.ts', 2, false, 'new'], ['config', 0, true], ['.env.production', 1, false, 'err'],
  ['Dockerfile', 0, false, 'mod'], ['package.json', 0, false, 'mod'],
];
const DOT: Record<string, string> = { warn: 'bg-warn', mod: 'bg-warn/60', info: 'bg-info', new: 'bg-[var(--neon-cyan)]', err: 'bg-err' };

export function WorkspaceScan() {
  return (
    <div aria-hidden="true" className="neon-frame relative overflow-hidden rounded-[20px]">
      <div className="flex items-center gap-2 border-b border-white/[.06] px-5 py-3 text-xs text-muted">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-3 mono">workspace · 128 files</span>
        <span className="status status-planned ml-auto !text-[10px]">Demonstration data</span>
      </div>
      <div className="grid md:grid-cols-[15rem_1fr]">
        <div className="hidden border-r border-white/[.06] py-4 text-[13px] md:block">
          {TREE.map(([n, d, dir, s]) => (
            <div key={n} className="flex items-center gap-2 py-[3px] pr-4" style={{ paddingLeft: 18 + d * 14 }}>
              {dir ? <FolderIcon className="h-3.5 w-3.5 text-dim" /> : <FileIcon className="h-3.5 w-3.5 text-dim" />}
              <span className={`mono truncate ${dir ? 'text-muted' : 'text-[#C9D3F5]'}`}>{n}</span>
              {s && <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${DOT[s]}`} />}
            </div>
          ))}
        </div>
        <div className="relative overflow-hidden p-5 sm:p-7">
          <div className="sweep-x pointer-events-none absolute inset-y-0 left-0 z-10 w-[12%] bg-[linear-gradient(90deg,transparent,rgba(56,225,255,.18)_70%,rgba(56,225,255,.55)_96%,transparent)] [--sweep-to:900%] md:w-[9%] md:[--sweep-to:1150%]" />
          <div className="grid grid-cols-10 gap-1.5 md:grid-cols-14 md:gap-2">
            {PATTERN.map((t, i) => (
              <div key={i} className={`flex aspect-square items-center justify-center rounded-md border ${STYLE[t]} ${i >= 70 ? 'max-md:hidden' : ''} ${['err', 'warn', 'info'].includes(t) ? 'pulse-soft' : ''}`}
                   style={['err', 'warn', 'info'].includes(t) ? { animationDelay: `${(i % 7) * -0.4}s` } : undefined}>
                <FileIcon className="h-3 w-3 md:h-3.5 md:w-3.5" />
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-[var(--neon-cyan)]" />New</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-warn" />Modified</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-err" />Finding</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-line2" />Not checked</span>
          </div>
        </div>
      </div>
    </div>
  );
}
