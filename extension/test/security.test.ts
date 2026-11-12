import * as assert from 'node:assert';
import { test } from 'node:test';
import { countBySeverity, findingsPanel, neighbour, parseReport, securityPage, SecurityModel, sortFindings, visible } from '../src/security/model';
import { renderFinding, setShowExplanations } from '../src/render';

const F = (over: any = {}) => ({ fingerprint: 'a1b2c3d4e5f6a7b8', rule_id: 'py-taint-sql', category: 'sql-injection', title: 'Request data in SQL statement', severity: 'critical',
  confidence: 'strongly_suspected', state: 'new', path: 'backend/database.py', line: 42, col: 12, end_line: 42, end_col: 60, file_level: false,
  evidence: 'conn.execute("SELECT …" + name)', reason: 'Request data reaches a SQL statement without parameters.', remediation: 'Use parameterised queries.', source: 'semgrep:py-taint-sql',
  also_reported_by: ['semgrep:sql-string-formatting'], ...over });
const raw = (over: any = {}) => JSON.stringify({ schema: 1, mode: 'full', status: 'complete', duration_ms: 1900, generated_at: '2026-11-12T10:00:00+00:00',
  findings: [F(), F({ fingerprint: 'bb22', severity: 'high', path: 'web/a.js', line: 3, col: 1, category: 'xss', title: 'XSS', state: 'existing' }),
    F({ fingerprint: 'cc33', severity: 'low', path: 'a/z.py', line: 9, state: 'suppressed', review: { reason: 'constant input', reviewed_by: 'sam', reviewed_at: '2026-11-01T00:00:00' } })],
  files: { included: 120, scanned: 118, from_cache: 100, excluded: { 'dependency directory': 2, 'ignored by Git': 5 }, excluded_samples: { 'ignored by Git': ['.env'] }, git: true },
  checks: [{ name: 'Static analysis', status: 'completed', detail: '40 file(s) analysed.' }, { name: 'Known-vulnerable dependency versions', status: 'skipped', detail: 'advisory lookups are off' }],
  coverage: [{ language: 'Python', files: 40, analysis: 'language-aware' }, { language: 'Ruby', files: 2, analysis: 'generic patterns only' }],
  tools: [{ name: 'semgrep', role: 'code rules', installed: true, version: '1.79.0', status: 'ready', detail: '' }], notes: [],
  baseline: { present: true, resolved: [{}], not_revalidated: [], suppressed: 1 }, gate: { decision: 'not_applicable', reasons: ['report only'] }, ...over });
const model = (over: Partial<SecurityModel> = {}): SecurityModel => ({ availability: 'ready', report: parseReport(raw()), groupBy: 'severity', automatic: true, scannerCommand: 'trustcode-scan', online: false, ...over });

test('scanner output is validated: junk is rejected, unsafe paths and bad findings are dropped', () => {
  for (const bad of ['', 'not json', '{}', '{"schema":2,"findings":[],"status":"complete"}', '{"schema":1,"findings":"x","status":"complete"}', '{"schema":1,"findings":[],"status":"great"}']) assert.strictEqual(parseReport(bad), undefined, bad);
  const r = parseReport(raw({ findings: [F(), F({ path: '../../etc/passwd' }), F({ path: '/abs/x.py' }), F({ severity: 'catastrophic' }), null, F({ line: -5, col: 'x', confidence: 'certain', state: 'weird' })] }))!;
  assert.strictEqual(r.findings.length, 2);
  assert.deepStrictEqual([r.findings[1].line, r.findings[1].col, r.findings[1].confidence, r.findings[1].state], [1, 1, 'potential', 'unclassified']);
});

test('counts, ordering and next/previous navigation ignore reviewed findings and wrap around', () => {
  const r = parseReport(raw())!;
  assert.deepStrictEqual(countBySeverity(r), { critical: 1, high: 1, medium: 0, low: 0, info: 0 });
  assert.deepStrictEqual(sortFindings(visible(r)).map((f) => f.severity), ['critical', 'high']);
  const v = visible(r);
  assert.strictEqual(neighbour(v, undefined, 1)!.path, 'backend/database.py');
  assert.strictEqual(neighbour(v, { path: 'backend/database.py', line: 42, col: 12 }, 1)!.path, 'web/a.js');
  assert.strictEqual(neighbour(v, { path: 'web/a.js', line: 3, col: 1 }, 1)!.path, 'backend/database.py', 'wraps to the first');
  assert.strictEqual(neighbour(v, { path: 'backend/database.py', line: 1, col: 1 }, -1)!.path, 'web/a.js', 'wraps to the last');
  assert.strictEqual(neighbour([], undefined, 1), undefined);
});

test('security tab: overview, exact location, severity, confidence and state; no long explanation, no verdict', () => {
  const html = securityPage(model());
  for (const a of ['full', 'changed', 'staged', 'push', 'production']) assert.match(html, new RegExp(`data-action="secScan" data-key="${a}"`));
  for (const a of ['secRescan', 'secOpen', 'secReview', 'secNext', 'secPrev', 'secBaseline', 'secHooks', 'secCi']) assert.match(html, new RegExp(`data-action="${a}"`), a);
  assert.match(html, /<div class="num">118<\/div><div class="lbl">Files scanned/);
  assert.match(html, /data-finding="a1b2c3d4e5f6a7b8">backend\/database\.py:42:12</);
  assert.match(html, />CRITICAL<[\s\S]*Request data in SQL statement[\s\S]*sql-injection[\s\S]*Strongly suspected[\s\S]*>New</);
  assert.match(html, /In baseline/);
  assert.match(html, /Reviewed false positives \(1\)[\s\S]*constant input[\s\S]*sam/);
  assert.match(html, /1 new · 0 reintroduced · 1 already in the baseline · 1 resolved/);
  assert.match(html, /1 completed, 1 skipped, 0 failed/);
  assert.match(html, /Ruby<\/strong>: 2 files — generic patterns only/);
  assert.match(html, /5 — ignored by Git/);
  assert.ok(!/Why it matters|Suggested next step|Explain for/.test(html), 'the security tab must not carry long explanations');
  assert.ok(!/\b(is secure|is safe|no vulnerabilities|all clear)\b/i.test(html.replace(/not<\/strong> a statement that the project is secure/g, '')));
  assert.match(findingsPanel(parseReport(raw())!, 'file'), /backend\/database\.py <span class="muted">\(1\)/);
  assert.match(findingsPanel(parseReport(raw())!, 'category'), /xss <span class="muted">\(1\)/);
});

test('incomplete, failed, missing-scanner and empty states are never shown as a clean result', () => {
  const inc = securityPage(model({ report: parseReport(raw({ status: 'incomplete', findings: [], checks: [{ name: 'Static analysis', status: 'failed', detail: 'Semgrep is not installed' }],
    gate: { decision: 'block', reasons: ['The scan is incomplete'] } })) }));
  assert.match(inc, /Scan INCOMPLETE/);
  assert.match(inc, /Some checks did not run/);
  assert.match(inc, /Policy decision: BLOCK/);
  assert.match(inc, /not<\/strong> a statement that the project is secure/);
  assert.match(inc, /<details class="card" open><summary class="card-title">Checks/);
  const missing = securityPage(model({ availability: 'missing', report: undefined }));
  assert.match(missing, /Scanner not found[\s\S]*nothing was scanned/);
  assert.match(missing, /TrustCode never installs software for you/);
  assert.match(missing, /data-action="secScan" data-key="full" disabled/);
  assert.match(securityPage(model({ report: undefined, error: 'no readable report <b>' })), /no readable report &lt;b&gt;/);
  assert.match(securityPage(model({ availability: 'untrusted' })), /Workspace not trusted/);
  assert.match(securityPage(model({ scanning: { mode: 'staged' } })), /Scanning — Before commit[\s\S]*data-action="secCancel"/);
  assert.ok(!securityPage(model({ report: parseReport(raw({ findings: [F({ title: '<img src=x>' })] })) })).includes('<img src=x>'));
});

test('explanations are off by default in the product and can be switched on', () => {
  const f = { finding_id: 'SEC-1', severity: 'high', what: 'SQL injection risk', where: 'Line 3', method: 'Semgrep', why: 'WHY-TEXT', next_step: 'NEXT-TEXT', evidence: 'raw', could_not_verify: 'c' };
  setShowExplanations(false);
  const off = renderFinding(f, true);
  assert.ok(!off.includes('WHY-TEXT') && !off.includes('NEXT-TEXT') && off.includes('SQL injection risk') && off.includes('raw'));
  setShowExplanations(true);
  assert.ok(renderFinding(f, true).includes('WHY-TEXT'));
});
