import * as assert from 'node:assert';
import { test } from 'node:test';
import { ageText, cacheKey, compareResults, findingIdFromMessage, flatFindings, hoverMarkdown, ResultCache, shiftRange, toLineEdit } from '../src/findings';
import { renderCachedNotice, renderChecks, renderComparison, renderFinding, renderFindings } from '../src/render';
import { progress, verifyForm } from '../src/ui';

const finding = (id: string, rule: string, line: number, excerpt: string, extra: any = {}) =>
  ({ id, check: 'security', tool: 'semgrep', rule_id: rule, title: `T ${rule}`, message: `m ${rule}`, severity: 'high',
    location: { line, end_line: line }, code_excerpt: excerpt, ...extra });
const result = (...fs: any[]) => ({ checks: [{ kind: 'security', status: fs.length ? 'issues_found' : 'passed', findings: fs }, { kind: 'lint', status: 'passed', findings: [] }] });

test('flatFindings tolerates missing data and keeps merged-report sources', () => {
  assert.deepStrictEqual(flatFindings(undefined), []);
  assert.deepStrictEqual(flatFindings({ checks: [{}] }), []);
  const [f] = flatFindings(result(finding('SEC-1', 'sql', 3, 'x', { metadata: { also_reported_by: ['a:b'] } })));
  assert.strictEqual(f.line, 3);
  assert.deepStrictEqual(f.alsoReportedBy, ['a:b']);
});

test('comparison matches findings across line shifts and reports new / no-longer-reported', () => {
  const prev = result(finding('SEC-1', 'sql', 3, 'conn.execute(q)'), finding('SEC-2', 'eval', 9, 'eval(x)'));
  const next = result(finding('SEC-1', 'sql', 7, 'conn.execute(q)'), finding('SEC-2', 'md5', 12, 'md5(p)'));
  const c = compareResults(prev, next);
  assert.strictEqual(c.unchanged, 1);
  assert.deepStrictEqual(c.resolved.map((f) => f.rule), ['eval']);
  assert.deepStrictEqual(c.added.map((f) => f.rule), ['md5']);
  // the same rule matching twice, then once: exactly one is no longer reported
  const twice = compareResults(result(finding('A-1', 'r', 1, 'same'), finding('A-2', 'r', 2, 'same')), result(finding('A-1', 'r', 1, 'same')));
  assert.strictEqual(twice.resolved.length, 1);
  assert.strictEqual(twice.unchanged, 1);
  assert.deepStrictEqual(compareResults(result(), { checks: [{ kind: 'security', status: 'check_failed', findings: [] }] }).checksChanged, ['security: passed → check_failed']);
});

test('comparison card never claims a fix was confirmed, and escapes titles', () => {
  const html = renderComparison(compareResults(result(finding('SEC-1', '<b>x</b>', 3, 'a')), result()));
  assert.match(html, /1 no longer reported/);
  assert.match(html, /not confirmation of a fix/);
  assert.ok(!/\b(fixed|safe|secure)\b/i.test(html.replace('not confirmation of a fix', '')), html);
  assert.ok(!html.includes('<b>x</b>'));
  assert.strictEqual(renderComparison(undefined), '');
  assert.match(renderComparison({ resolved: [], added: [], unchanged: 2, checksChanged: [] }), /Same findings as before \(2 unchanged\)/);
});

test('marks follow edits: above = unchanged, below = shifted, touched = removed', () => {
  const r = { start: 10, end: 11 };
  assert.deepStrictEqual(shiftRange(r, toLineEdit(20, 0, 20, 'x')), r);                       // edit below
  assert.deepStrictEqual(shiftRange(r, toLineEdit(2, 4, 2, 'a\nb\n')), { start: 12, end: 13 });   // two lines inserted above
  assert.deepStrictEqual(shiftRange(r, toLineEdit(3, 0, 5, '')), { start: 8, end: 9 });        // two lines deleted above
  assert.strictEqual(shiftRange(r, toLineEdit(10, 2, 10, 'x')), undefined);                   // typed on the line
  assert.strictEqual(shiftRange(r, toLineEdit(9, 0, 12, '')), undefined);                     // deleted with surroundings
  assert.deepStrictEqual(shiftRange(r, toLineEdit(10, 0, 10, 'new line\n')), { start: 11, end: 12 });  // line inserted directly above
  assert.deepStrictEqual(shiftRange(r, toLineEdit(9, 5, 9, 'x')), r);                          // same-line edit just above
});

test('result cache: keyed by every input, expires, and is bounded', () => {
  assert.notStrictEqual(cacheKey(['a', 'bc']), cacheKey(['ab', 'c']));
  assert.notStrictEqual(cacheKey(['s', 'python', 'code', undefined, undefined]), cacheKey(['s', 'python', 'code', 'task', undefined]));
  assert.strictEqual(cacheKey(['s', 'x']), cacheKey(['s', 'x']));
  let now = 0;
  const c = new ResultCache<number>(1000, 2, () => now);
  c.set('a', 1); now = 500;
  assert.deepStrictEqual(c.get('a'), { value: 1, ageMs: 500 });
  now = 1501;
  assert.strictEqual(c.get('a'), undefined);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.strictEqual(c.size, 2);
  assert.strictEqual(c.get('a'), undefined);
  assert.match(renderCachedNotice(ageText(125_000)), /2 min ago.*nothing was sent again.*data-action="rerun"/s);
  assert.strictEqual(renderCachedNotice(undefined), '');
});

test('hover: escaped markdown, evidence always present, one fixed command link with a validated id', () => {
  const [f] = flatFindings(result(finding('SEC-1', 'sql', 3, 'x', { title: 'Bad [link](command:evil) <img>', message: 'tool `said` *this*' })));
  const md = hoverMarkdown(f, { why: 'because', next_step: 'do', could_not_verify: 'reach', your_feedback: { note: 'You marked this wrong 2 times.' } });
  assert.ok(!md.includes('](command:evil)'), md);
  assert.match(md, /\*\*Evidence\*\* \(semgrep · sql\)/);
  assert.match(md, /\*\*Not verified:\*\* reach/);
  assert.match(md, /You marked this wrong 2 times/);
  assert.strictEqual((md.match(/\]\(command:/g) ?? []).length, 1);
  assert.match(md, /command:trustcode\.showFinding\?%5B%22SEC-1%22%5D/);
  const noId = hoverMarkdown({ ...f, id: '"]);evil(' });
  assert.ok(!noId.includes('trustcode.showFinding') && !/(?<!\\)\]\(command:/.test(noId), noId);
  assert.ok(!/\b(safe|secure|correct)\b/i.test(md));
});

test('diagnostic messages carry the finding id for quick actions', () => {
  assert.strictEqual(findingIdFromMessage('SQL injection risk (SEC-1) — built with formatting'), 'SEC-1');
  assert.strictEqual(findingIdFromMessage('call (x) — y'), undefined);
});

test('findings are grouped by severity with text labels; merged reports and feedback notes are shown', () => {
  const view = { findings: [
    { finding_id: 'SEC-1', severity: 'high', what: 'A', where: 'Line 1', also_reported_by: ['trustcode-secrets:github-token'] },
    { finding_id: 'LINT-1', severity: 'low', what: 'B', where: 'Line 2', your_feedback: { note: 'You marked findings from this rule as wrong 2 times.' } },
    { finding_id: 'X-1', severity: 'weird', what: 'C', where: 'Line 3' }] };
  const html = renderFindings(view);
  assert.match(html, /Critical \/ high <span class="muted">\(1\)<\/span>/);
  assert.match(html, /Low \/ info <span class="muted">\(2\)<\/span>/);   // unknown severities are never dropped
  assert.ok(!html.includes('>Medium <'));
  assert.strictEqual((html.match(/data-fid="/g) ?? []).length, 3);
  assert.match(html, /Also reported by<\/dt><dd>trustcode-secrets:github-token/);
  assert.match(html, /class="learned small"[^>]*>.*marked findings from this rule as wrong 2 times/s);
  assert.match(renderFinding({ finding_id: 'A-1', severity: 'high' }, false), /data-fid="A-1"/);
});

test('new check kinds have names; form offers file verification; progress lists every check', () => {
  const html = renderChecks({ checks: [{ kind: 'secrets', status: 'passed' }, { kind: 'types', status: 'not_run' }] });
  assert.match(html, /Hardcoded secrets/);
  assert.match(html, /Type checking/);
  assert.match(verifyForm(undefined), /data-action="verifyFile"/);
  assert.match(verifyForm({ lines: 40, language: 'python', file: 'a.py', whole: true }), /Whole file \(40 lines\)/);
  assert.match(progress('running'), /Type checking.*Hardcoded secrets/s);
});
