import { LogoMark } from '@/components/logo';
import { AlertIcon, CheckIcon, MinusIcon } from '@/components/icons';

/** Decorative product illustration (sign-in pages). Mirrors the real panel's structure; not a screenshot. */
export function PanelArt() {
  const lines = ['def find_user(conn, name):', '    q = f"SELECT … {name}"', '    return conn.execute(q)'];
  return (
    <div aria-hidden="true" className="w-full max-w-md select-none">
      <div className="overflow-hidden rounded-2xl border border-line2 bg-card shadow-[0_40px_100px_-40px_rgba(0,0,0,.6)]">
        <div className="flex items-center gap-1.5 border-b border-line bg-bg2 px-4 py-2.5"><span className="h-2 w-2 rounded-full bg-line2" /><span className="h-2 w-2 rounded-full bg-line2" /><span className="h-2 w-2 rounded-full bg-line2" /></div>
        <div className="py-2 font-mono text-[12px] leading-6">
          {lines.map((l, i) => (
            <div key={l} className={`relative flex pl-3 pr-4 ${i === 1 ? 'bg-warn/10' : ''}`}>
              {i !== 1 && <span className="hatch absolute inset-0" />}
              <span className="relative w-4">{i === 1 && <span className="mt-2.5 block h-1.5 w-1.5 rounded-full bg-warn" />}</span>
              <span className="relative w-5 text-dim">{i + 1}</span><span className="relative truncate text-fg">{l}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 border-t border-line bg-bg2 p-3">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold"><LogoMark className="h-3.5 w-3.5" />TrustCode</div>
          {([['Syntax', 'ok'], ['Security', 'warn'], ['Dependencies', 'ok'], ['Tests', 'none']] as const).map(([t, s]) => (
            <div key={t} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] ${s === 'warn' ? 'border-warn/40 bg-warn/5' : 'border-line bg-card'}`}>
              {s === 'ok' ? <CheckIcon className="h-3.5 w-3.5 text-ok" /> : s === 'warn' ? <AlertIcon className="h-3.5 w-3.5 text-warn" /> : <MinusIcon className="h-3.5 w-3.5 text-dim" />}
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
