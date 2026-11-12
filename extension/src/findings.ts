// Pure helpers for working with verification evidence in the editor (no vscode import -> unit-testable).
import { createHash } from 'crypto';
import { explanationsShown } from './render';

export interface FlatFinding {
  id: string; check: string; tool: string; rule?: string; title: string; message: string; severity: string;
  line?: number; endLine?: number; excerpt?: string; alsoReportedBy: string[];
}

/** All findings of a raw engine result, in check order. Lines are 1-based and relative to the submitted code. */
export function flatFindings(result: any): FlatFinding[] {
  const out: FlatFinding[] = [];
  for (const c of result?.checks ?? []) {
    for (const f of c?.findings ?? []) {
      out.push({
        id: String(f.id ?? ''), check: String(f.check ?? c.kind ?? ''), tool: String(f.tool ?? c.tool ?? ''),
        rule: f.rule_id ?? undefined, title: String(f.title ?? ''), message: String(f.message ?? ''),
        severity: String(f.severity ?? 'info'), line: f.location?.line ?? undefined,
        endLine: f.location?.end_line ?? f.location?.line ?? undefined, excerpt: f.code_excerpt ?? undefined,
        alsoReportedBy: Array.isArray(f.metadata?.also_reported_by) ? f.metadata.also_reported_by.map(String) : [],
      });
    }
  }
  return out;
}

/** Identity of a finding that survives line shifts between two verifications of edited code. */
export function fingerprint(f: FlatFinding): string {
  const text = (f.excerpt ?? f.title).replace(/\s+/g, ' ').trim();
  return `${f.check}|${f.tool}|${f.rule ?? ''}|${text}`;
}

export interface Comparison { resolved: FlatFinding[]; added: FlatFinding[]; unchanged: number; checksChanged: string[] }

/**
 * What changed between two verification results of the same document.
 * "Resolved" means only "no longer reported": the line may have been deleted, not fixed.
 */
export function compareResults(prev: any, next: any): Comparison {
  const before = flatFindings(prev), after = flatFindings(next);
  const count = (fs: FlatFinding[]) => {
    const m = new Map<string, FlatFinding[]>();
    for (const f of fs) { const k = fingerprint(f); m.set(k, [...(m.get(k) ?? []), f]); }
    return m;
  };
  const a = count(before), b = count(after);
  const resolved: FlatFinding[] = [], added: FlatFinding[] = [];
  let unchanged = 0;
  for (const [k, list] of a) {
    const now = b.get(k)?.length ?? 0;
    unchanged += Math.min(list.length, now);
    resolved.push(...list.slice(now));
  }
  for (const [k, list] of b) added.push(...list.slice(a.get(k)?.length ?? 0));
  const status = (r: any) => new Map<string, string>((r?.checks ?? []).map((c: any) => [String(c.kind), String(c.status)]));
  const sa = status(prev), sb = status(next);
  const checksChanged = [...sb].filter(([k, v]) => sa.has(k) && sa.get(k) !== v).map(([k, v]) => `${k}: ${sa.get(k)} → ${v}`);
  return { resolved, added, unchanged, checksChanged };
}

export interface LineRange { start: number; end: number }  // 0-based, inclusive document lines
export interface LineEdit { startLine: number; endLine: number; newLineCount: number }  // replaced lines [startLine, endLine] -> newLineCount lines

/**
 * Where a marked range is after an edit. Returns undefined when the edit touched the range: the evidence
 * was produced for the old text of those lines, so it must not stay attached to the new text.
 */
export function shiftRange(r: LineRange, e: LineEdit): LineRange | undefined {
  if (e.endLine < r.start) {
    const delta = e.newLineCount - (e.endLine - e.startLine + 1);
    return delta === 0 ? r : { start: r.start + delta, end: r.end + delta };
  }
  if (e.startLine > r.end) return r;
  return undefined;
}

/** Converts a VS Code content change (range + inserted text) to a LineEdit. */
export function toLineEdit(startLine: number, startChar: number, endLine: number, text: string): LineEdit {
  const inserted = text.split('\n').length - 1;
  // An insertion at column 0 that ends with a newline pushes the start line down without changing its text.
  if (startLine === endLine && startChar === 0 && text.endsWith('\n') && inserted > 0) {
    return { startLine, endLine: startLine - 1, newLineCount: inserted };
  }
  return { startLine, endLine, newLineCount: inserted + 1 };
}

export function cacheKey(parts: Array<string | undefined>): string {
  const h = createHash('sha256');
  for (const p of parts) { h.update(String((p ?? '').length)); h.update(':'); h.update(p ?? ''); h.update('\0'); }
  return h.digest('hex');
}

/** Small in-memory cache of finished verifications, so identical code is not sent or analysed twice. */
export class ResultCache<T> {
  private items = new Map<string, { value: T; at: number }>();
  constructor(private ttlMs = 10 * 60 * 1000, private max = 20, private now: () => number = Date.now) {}
  get(key: string): { value: T; ageMs: number } | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    const ageMs = this.now() - hit.at;
    if (ageMs > this.ttlMs) { this.items.delete(key); return undefined; }
    return { value: hit.value, ageMs };
  }
  set(key: string, value: T) {
    this.items.delete(key);
    this.items.set(key, { value, at: this.now() });
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value as string);
  }
  delete(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
  get size() { return this.items.size; }
}

const mdEsc = (v: unknown) => String(v ?? '').replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&').replace(/\r?\n/g, ' ');

/**
 * Hover text for a finding. `explained` is the server's explanation item for the same finding id (optional).
 * All dynamic text is Markdown-escaped; the only link is a fixed command with a validated finding id.
 */
export function hoverMarkdown(f: FlatFinding, explained?: any, source?: 'session'): string {
  const id = /^[A-Z]{2,5}-\d{1,4}$/.test(f.id) ? f.id : '';
  const lines = [`**TrustCode · ${mdEsc(f.severity.toUpperCase())}** — ${mdEsc(f.title)}${id ? ` \`${id}\`` : ''}`, ''];
  if (explained?.why && explanationsShown()) lines.push(`**Why it matters:** ${mdEsc(explained.why)}`, '');
  if (explained?.next_step && explanationsShown()) lines.push(`**Suggested next step:** ${mdEsc(explained.next_step)}`, '');
  lines.push(`**Evidence** (${mdEsc(f.tool)}${f.rule ? ` · ${mdEsc(f.rule)}` : ''}): ${mdEsc(f.message)}`, '');
  if (f.alsoReportedBy.length) lines.push(`Also reported by: ${f.alsoReportedBy.map(mdEsc).join(', ')}`, '');
  if (explained?.could_not_verify) lines.push(`**Not verified:** ${mdEsc(explained.could_not_verify)}`, '');
  if (explained?.your_feedback?.note) lines.push(`_${mdEsc(explained.your_feedback.note)}_`, '');
  if (id) lines.push(`[Explain in TrustCode panel](command:trustcode.showFinding?${encodeURIComponent(JSON.stringify(source ? [id, source] : [id]))})`);
  return lines.join('\n');
}

/** Extracts the finding id that TrustCode puts into its diagnostic messages. */
export function findingIdFromMessage(message: string): string | undefined {
  return /\(([A-Z]{2,5}-\d{1,4})\) — /.exec(message)?.[1];
}

export function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}
