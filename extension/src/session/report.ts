// Session verification reports (pure): batching, merging, comparison between runs, and the fix prompt.

export interface PlanFile { path: string; chars: number; attach: string[] }  // attach: context/related paths needed in the same batch
export interface BatchLimits { maxFiles: number; maxChars: number }

/**
 * Groups files into requests the server accepts. Files stay in path order so a directory tends to share a
 * batch; the files a member needs for cross-file checks travel with it. Nothing is dropped: a file that
 * cannot fit even alone is returned in `oversized` so the caller can report it.
 */
export function planBatches(files: PlanFile[], attachChars: (path: string) => number, limits: BatchLimits): { batches: Array<{ files: string[]; attach: string[] }>; oversized: string[] } {
  const batches: Array<{ files: string[]; attach: string[]; chars: number }> = [];
  const oversized: string[] = [];
  let cur = { files: [] as string[], attach: [] as string[], chars: 0 };
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (f.chars > limits.maxChars) { oversized.push(f.path); continue; }
    const fit = (b: typeof cur, attach: string[]) => {
      const extra = attach.filter((a) => !b.attach.includes(a) && !b.files.includes(a));
      const chars = b.chars + f.chars + extra.reduce((n, a) => n + attachChars(a), 0);
      return { ok: b.files.length + b.attach.length + 1 + extra.length <= limits.maxFiles && chars <= limits.maxChars, extra, chars };
    };
    let attach = f.attach.filter((a) => a !== f.path);
    let r = fit(cur, attach);
    if (!r.ok && cur.files.length) { batches.push(cur); cur = { files: [], attach: [], chars: 0 }; r = fit(cur, attach); }
    while (!r.ok && attach.length) { attach = attach.slice(0, -1); r = fit(cur, attach); }  // shed related files before giving up
    cur.attach = cur.attach.filter((a) => a !== f.path);
    cur.files.push(f.path); cur.attach.push(...r.extra); cur.chars = r.chars;
  }
  if (cur.files.length) batches.push(cur);
  return { batches: batches.map(({ files: fs, attach }) => ({ files: fs, attach: attach.filter((a) => !fs.includes(a)) })), oversized };
}

export interface SessionFinding {
  id: string; serverId: string; jobId: string; path: string; line?: number; endLine?: number; severity: string; title: string; message: string;
  check: string; tool: string; rule?: string; excerpt?: string; introduced: 'new' | 'preexisting' | 'unknown';
  deterministic: boolean; crossFile: boolean; why?: string; nextStep?: string; couldNotVerify?: string; feedbackNote?: string;
}
export interface MergedReport {
  depth: string; jobIds: string[]; files: any[]; projectChecks: any[]; notExecuted: any[]; findings: SessionFinding[];
  notAnalysed: Array<{ path: string; reason: string }>; checks: Record<string, Record<string, number>>;
  bySeverity: Record<string, number>; origin: { new: number; preexisting: number; unknown: number }; filesChanged: number; filesAnalysed: number;
  disclaimer: string;
}

const SEV = ['critical', 'high', 'medium', 'low', 'info'];
const WORST = ['check_failed', 'issues_found', 'needs_review', 'not_run', 'passed'];
const SUPPORT = (c: string) => c === 'context' || c === 'related';

/** Combines the per-batch server reports into one. Finding ids are renumbered so they stay unique. */
export function mergeReports(reports: any[]): MergedReport {
  const files = new Map<string, any>();
  const findings: SessionFinding[] = [];
  const seen = new Set<string>();
  const counters: Record<string, number> = {};
  const project = new Map<string, any>();
  const notExecuted = new Map<string, any>();
  for (const r of reports) {
    for (const f of r?.files ?? []) {
      const prev = files.get(f.path);
      // a file may be a changed file in one batch and supporting context in another: the changed entry wins
      if (!prev || (SUPPORT(prev.change) && !SUPPORT(f.change))) files.set(f.path, { ...f, findings: [] });
      for (const x of f.findings ?? []) {
        const key = `${f.path}|${x.check}|${x.tool}|${x.rule_id}|${x.location?.line}|${x.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const prefix = String(x.id ?? 'GEN-0').split('-')[0];
        counters[prefix] = (counters[prefix] ?? 0) + 1;
        findings.push({
          id: `${prefix}-${counters[prefix]}`, serverId: String(x.id), jobId: String(r.job_id ?? ''), path: f.path,
          line: x.location?.line ?? undefined, endLine: x.location?.end_line ?? x.location?.line ?? undefined,
          severity: String(x.severity ?? 'info'), title: String(x.title ?? ''), message: String(x.message ?? ''),
          check: String(x.check ?? ''), tool: String(x.tool ?? ''), rule: x.rule_id ?? undefined, excerpt: x.code_excerpt ?? undefined,
          introduced: x.introduced === 'new' || x.introduced === 'preexisting' ? x.introduced : 'unknown',
          deterministic: x.status !== 'needs_human_review', crossFile: !!x.metadata?.cross_file,
          why: x.explained?.why, nextStep: x.explained?.next_step, couldNotVerify: x.explained?.could_not_verify,
          feedbackNote: x.explained?.your_feedback?.note,
        });
      }
    }
    for (const c of r?.project_checks ?? []) {
      const prev = project.get(c.kind);
      if (!prev) { project.set(c.kind, { ...c, summaries: [c.summary] }); continue; }
      prev.summaries.push(c.summary);
      if (WORST.indexOf(c.status) < WORST.indexOf(prev.status)) prev.status = c.status;
    }
    for (const n of r?.not_executed ?? []) notExecuted.set(n.check, n);
  }
  findings.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  const all = [...files.values()];
  const changed = all.filter((f) => !SUPPORT(f.change));
  const checks: Record<string, Record<string, number>> = {};
  for (const f of changed) for (const c of f.checks ?? []) { (checks[c.kind] ??= {})[c.status] = (checks[c.kind][c.status] ?? 0) + 1; }
  const bySeverity: Record<string, number> = {};
  for (const s of SEV) bySeverity[s] = findings.filter((f) => f.severity === s).length;
  return {
    depth: String(reports[0]?.depth ?? 'standard'), jobIds: reports.map((r) => String(r?.job_id ?? '')).filter(Boolean), files: all,
    projectChecks: [...project.values()].map((c) => ({ ...c, summary: [...new Set(c.summaries as string[])].join(' · ') })),
    notExecuted: [...notExecuted.values()], findings,
    notAnalysed: changed.filter((f) => !f.analysed).map((f) => ({ path: f.path, reason: String(f.reason ?? 'not analysed') })),
    checks, bySeverity,
    origin: { new: findings.filter((f) => f.introduced === 'new').length, preexisting: findings.filter((f) => f.introduced === 'preexisting').length,
      unknown: findings.filter((f) => f.introduced === 'unknown').length },
    filesChanged: changed.length, filesAnalysed: changed.filter((f) => f.analysed).length,
    disclaimer: String(reports[0]?.disclaimer ?? ''),
  };
}

/** Identity of a finding across runs: survives line shifts, tied to the file. */
export const findingKey = (f: SessionFinding) => `${f.path}|${f.check}|${f.tool}|${f.rule ?? ''}|${(f.excerpt ?? f.title).replace(/\s+/g, ' ').trim()}`;

export interface RunComparison { noLongerReported: SessionFinding[]; added: SessionFinding[]; unchanged: number; notRechecked: SessionFinding[] }

/**
 * Differences between two runs. A finding from the earlier run counts as "no longer reported" only if its
 * file was analysed again in the later run; otherwise it is "not re-checked" - absence of a re-check is not
 * evidence that anything was resolved.
 */
export function compareRuns(prev: MergedReport, next: MergedReport): RunComparison {
  const analysedNow = new Set(next.files.filter((f) => !SUPPORT(f.change) && (f.analysed || f.change === 'deleted')).map((f) => f.path));
  const pool = new Map<string, SessionFinding[]>();
  for (const f of next.findings) pool.set(findingKey(f), [...(pool.get(findingKey(f)) ?? []), f]);
  const noLongerReported: SessionFinding[] = [], notRechecked: SessionFinding[] = [];
  let unchanged = 0;
  for (const f of prev.findings) {
    const hits = pool.get(findingKey(f));
    if (hits?.length) { hits.shift(); unchanged++; }
    else if (analysedNow.has(f.path)) noLongerReported.push(f);
    else notRechecked.push(f);
  }
  return { noLongerReported, added: [...pool.values()].flat(), unchanged, notRechecked };
}

/**
 * A prompt the developer can hand to their coding agent. Lists only tool evidence; pre-existing issues are
 * separated so the agent is not asked to refactor code the change did not touch.
 */
export function buildFixPrompt(findings: SessionFinding[], opts: { includePreexisting?: boolean } = {}): string {
  const mine = findings.filter((f) => f.introduced !== 'preexisting');
  const old = findings.filter((f) => f.introduced === 'preexisting');
  const item = (f: SessionFinding, i: number) => [
    `${i + 1}. ${f.path}${f.line ? `:${f.line}` : ''} — ${f.title} [${f.severity}]`,
    `   Evidence (${f.tool}${f.rule ? ` ${f.rule}` : ''}): ${f.message.replace(/\s+/g, ' ')}`,
    f.excerpt ? `   Code: ${f.excerpt}` : '',
    f.nextStep ? `   Suggested direction: ${f.nextStep.replace(/\s+/g, ' ')}` : '',
    f.deterministic ? '' : '   Note: flagged for human review, not a confirmed defect — check before changing anything.',
  ].filter(Boolean).join('\n');
  const lines = [
    `TrustCode's automated checks reported ${mine.length} issue${mine.length === 1 ? '' : 's'} in the recent changes. Please fix them.`,
    '',
    'Rules:',
    '- Fix only the issues listed below. Do not change unrelated functionality, formatting or files.',
    '- If you believe an item is a false alarm, say so and explain why instead of changing the code.',
    '- After making the changes, run the relevant tests and report what you ran and the result.',
    '',
    'Issues:',
    ...mine.map(item),
  ];
  if (old.length && opts.includePreexisting) {
    lines.push('', 'Already present before these changes (fix only if asked):', ...old.map(item));
  } else if (old.length) {
    lines.push('', `(${old.length} further issue${old.length === 1 ? ' was' : 's were'} already present before these changes and ${old.length === 1 ? 'is' : 'are'} not listed.)`);
  }
  return lines.join('\n');
}

export interface RunRecord {
  id: string; at: number; finishedAt: number; scope: string; depth: string; trigger: string; report: MergedReport;
  verified: Record<string, string>;   // path -> content key that was verified
  skipped: Array<{ path: string; reason: string }>;  // changed files that were not sent, with the reason
  cancelled?: boolean;
}

/** Files whose content changed after the run read them: the run does not describe their current state. */
export function outdatedFiles(run: RunRecord, currentKey: (path: string) => string | undefined): string[] {
  return Object.entries(run.verified).filter(([p, k]) => currentKey(p) !== k).map(([p]) => p).sort();
}
