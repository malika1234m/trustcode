import Link from 'next/link';

/** Page numbers to show: always first and last, the current page and its neighbours, gaps as null. */
function pages(current: number, last: number): (number | null)[] {
  const set = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

/** Reads ?page=N safely (1-based). */
export function pageFrom(v: string | undefined): number {
  const n = Number.parseInt(v ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

/** Numbered pagination as links (works without JavaScript; keeps other query parameters). */
export function Pagination({ basePath, params = {}, page, pageSize, total, label = 'items' }:
  { basePath: string; params?: Record<string, string | undefined>; page: number; pageSize: number; total: number; label?: string }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    if (p > 1) q.set('page', String(p)); else q.delete('page');
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const beyond = page > last;                      // e.g. ?page=99 after items were deleted
  const cur = Math.min(page, last);
  const from = (cur - 1) * pageSize + 1, to = Math.min(cur * pageSize, total);
  const noun = total === 1 ? label.replace(/s$/, '') : label;
  const btn = 'flex min-h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm transition-colors';
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-dim" aria-live="polite">{beyond ? <>No {label} on page {page}. <Link href={href(last)} className="text-brand underline underline-offset-2">Go to page {last}</Link></> : `Showing ${from}–${to} of ${total} ${noun}`}</p>
      {last > 1 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          <li>{cur > 1 && !beyond ? <Link href={href(cur - 1)} rel="prev" className={`${btn} border-line text-muted hover:border-brand hover:text-fg`}>Previous</Link>
                        : <span aria-disabled="true" className={`${btn} border-line text-dim opacity-50`}>Previous</span>}</li>
          {pages(cur, last).map((p, i) => p === null
            ? <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-dim">…</li>
            : <li key={p}><Link href={href(p)} aria-label={`Page ${p}`} aria-current={p === cur && !beyond ? 'page' : undefined}
                    className={`${btn} ${p === cur && !beyond ? 'border-brand bg-brand/15 font-semibold text-fg' : 'border-line text-muted hover:border-brand hover:text-fg'}`}>{p}</Link></li>)}
          <li>{cur < last ? <Link href={href(cur + 1)} rel="next" className={`${btn} border-line text-muted hover:border-brand hover:text-fg`}>Next</Link>
                           : <span aria-disabled="true" className={`${btn} border-line text-dim opacity-50`}>Next</span>}</li>
        </ul>
      )}
    </nav>
  );
}
