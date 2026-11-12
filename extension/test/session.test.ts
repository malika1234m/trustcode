import * as assert from 'node:assert';
import { test } from 'node:test';
import { importsAnyOf, jsSpecifiers, localImports, nearestManifests, pyImports } from '../src/session/imports';
import {
  absorbPausedChange, awaitingVerification, categorize, counts, DEFAULT_EXCLUDE, DEFAULT_SENSITIVE, deserialize, effectiveChanges, FileState,
  globToRegExp, inactivityReached, isSensitive, markCompletion, newSession, noteActivity, observe, parseAgentSignal, serialize, trackingDecision, verificationKey,
} from '../src/session/model';
import { buildFixPrompt, compareRuns, mergeReports, outdatedFiles, planBatches, SessionFinding } from '../src/session/report';
import { changedFiles, DashboardModel, runReport, sessionPage, settingsCard, statusLine } from '../src/session/render';
import { page, TABS } from '../src/ui';

const st = (hash: string, size = 10, mtime = 1): FileState => ({ hash, size, mtime });
const rules = { exclude: DEFAULT_EXCLUDE, include: [] as string[], extensions: [] as string[], sensitive: DEFAULT_SENSITIVE, maxFileSizeBytes: 1e6 };
function session(baseline: Record<string, string>) {
  const s = newSession('s1', 'Claude Code', 1000);
  for (const [p, h] of Object.entries(baseline)) s.baseline[p] = st(h);
  return s;
}

// ---------------------------------------------------------------- model
test('changes are derived from the baseline: created, modified, deleted, and undone edits disappear', () => {
  const s = session({ 'a.py': 'A', 'b.py': 'B' });
  assert.strictEqual(observe(s, 'a.py', st('A'), 1), false, 'unchanged content is not a change');
  assert.strictEqual(observe(s, 'a.py', st('A2'), 2), true);
  assert.strictEqual(observe(s, 'new.ts', st('N'), 3), true);
  assert.strictEqual(observe(s, 'b.py', undefined, 4), true);
  assert.deepStrictEqual(effectiveChanges(s).map((c) => [c.path, c.kind]), [['a.py', 'modified'], ['b.py', 'deleted'], ['new.ts', 'created']]);
  assert.strictEqual(observe(s, 'a.py', st('A'), 5), true, 'reverting to the baseline removes the change');
  assert.strictEqual(observe(s, 'new.ts', undefined, 6), true, 'a file created and deleted within the session leaves no trace');
  assert.deepStrictEqual(Object.keys(s.changes), ['b.py']);
});

test('duplicate events for one write are no-ops (watcher + save + rescan)', () => {
  const s = session({ 'a.py': 'A' });
  assert.strictEqual(observe(s, 'a.py', st('A2'), 10), true);
  const seen = s.changes['a.py'].lastSeen;
  for (let i = 0; i < 5; i++) assert.strictEqual(observe(s, 'a.py', st('A2', 10, 99 + i), 20 + i), false);
  assert.strictEqual(s.changes['a.py'].lastSeen, seen);
  assert.strictEqual(observe(s, 'gone.py', undefined, 30), false, 'a path that never existed is not a deletion');
});

test('pre-existing uncommitted edits are baseline, not session changes', () => {
  // the developer's dirty file has its dirty content as the baseline
  const s = session({ 'mine.py': 'DIRTY-BEFORE-SESSION' });
  assert.strictEqual(observe(s, 'mine.py', st('DIRTY-BEFORE-SESSION'), 1), false);
  assert.strictEqual(counts(s).total, 0);
  observe(s, 'mine.py', st('AGENT-EDIT'), 2);
  assert.strictEqual(effectiveChanges(s)[0].kind, 'modified');
});

test('renames and moves are inferred from identical content, one-to-one', () => {
  const s = session({ 'src/util.ts': 'U', 'src/a.ts': 'SAME', 'src/b.ts': 'SAME', 'keep.ts': 'K' });
  observe(s, 'src/util.ts', undefined, 1); observe(s, 'src/helpers/util.ts', st('U'), 1);
  observe(s, 'src/a.ts', undefined, 2); observe(s, 'lib/a.ts', st('SAME'), 2);
  observe(s, 'edited.ts', st('E'), 3);
  const eff = effectiveChanges(s);
  assert.deepStrictEqual(eff.map((c) => [c.path, c.kind, c.from]), [['edited.ts', 'created', undefined], ['lib/a.ts', 'renamed', 'src/a.ts'], ['src/helpers/util.ts', 'renamed', 'src/util.ts']]);
  const c = counts(s);
  assert.deepStrictEqual([c.created, c.renamed, c.deleted, c.total], [1, 2, 0, 3]);
  // a file renamed AND edited no longer has identical content: reported honestly as delete + create
  const t = session({ 'old.py': 'O' });
  observe(t, 'old.py', undefined, 1); observe(t, 'new.py', st('O-edited'), 1);
  assert.deepStrictEqual(effectiveChanges(t).map((x) => x.kind).sort(), ['created', 'deleted']);
});

test('pause: changes made while paused are absorbed into the baseline; mixed files are flagged', () => {
  const s = session({ 'agent.py': 'A', 'manual.py': 'M', 'both.py': 'B', 'removed.py': 'R' });
  observe(s, 'agent.py', st('A1'), 1); observe(s, 'both.py', st('B1'), 1);
  s.status = 'paused';
  assert.strictEqual(absorbPausedChange(s, 'manual.py', st('M-by-developer')), 'absorbed');
  assert.strictEqual(absorbPausedChange(s, 'created-while-paused.py', st('X')), 'absorbed');
  assert.strictEqual(absorbPausedChange(s, 'removed.py', undefined), 'absorbed');
  assert.strictEqual(absorbPausedChange(s, 'both.py', st('B2')), 'mixed');
  assert.strictEqual(absorbPausedChange(s, 'agent.py', st('A1')), 'unchanged');
  assert.deepStrictEqual(effectiveChanges(s).map((c) => [c.path, !!c.mixed]), [['agent.py', false], ['both.py', true]]);
  // after resuming, a new edit to the absorbed file IS a session change
  observe(s, 'manual.py', st('M-by-agent'), 9);
  assert.ok(s.changes['manual.py']);
});

test('awaiting verification follows content, not events', () => {
  const s = session({ 'a.py': 'A', 'd.py': 'D' });
  observe(s, 'a.py', st('A1'), 1); observe(s, 'd.py', undefined, 1);
  assert.strictEqual(awaitingVerification(s).length, 2);
  s.changes['a.py'].verifiedHash = 'A1'; s.changes['d.py'].verifiedHash = 'deleted';
  assert.strictEqual(counts(s).awaiting, 0);
  observe(s, 'a.py', st('A2'), 2);   // the agent kept editing after the verification
  assert.deepStrictEqual(awaitingVerification(s).map((c) => c.path), ['a.py']);
  assert.strictEqual(verificationKey(s.changes['d.py']), 'deleted');
});

test('completion: a confirmed agent signal is distinct from an inactivity estimate and is never downgraded', () => {
  const s = session({ 'a.py': 'A' });
  assert.strictEqual(inactivityReached(s, 60, 1e9), false, 'no changes yet: nothing to review');
  observe(s, 'a.py', st('A1'), 1000);
  assert.strictEqual(inactivityReached(s, 60, 1000 + 59_000), false);
  assert.strictEqual(inactivityReached(s, 60, 1000 + 60_000), true);
  assert.strictEqual(inactivityReached(s, 0, 1e12), false, '0 turns the estimate off');
  assert.ok(markCompletion(s, { kind: 'inactivity_estimate', at: 1, detail: 'x' }));
  assert.match(statusLine({ ...dash(s).session!, completion: s.completion }).chip, /Possibly finished \(estimate\)/);
  assert.match(statusLine({ ...dash(s).session!, completion: s.completion }).text, /cannot confirm that the agent is done/);
  assert.ok(markCompletion(s, { kind: 'agent_signal', at: 2, detail: 'claude-code reported that it finished a turn' }));
  assert.strictEqual(markCompletion(s, { kind: 'inactivity_estimate', at: 3, detail: 'y' }), false);
  assert.match(statusLine({ ...dash(s).session!, status: s.status, completion: s.completion }).chip, /Agent reported it finished/);
  noteActivity(s);   // the agent starts changing files again
  assert.deepStrictEqual([s.status, s.completion], ['tracking', undefined]);
  s.status = 'paused';
  assert.strictEqual(markCompletion(s, { kind: 'agent_signal', at: 4, detail: 'z' }), false);
  assert.strictEqual(inactivityReached(s, 1, 1e12), false);
});

test('agent signal file is validated as untrusted data', () => {
  assert.deepStrictEqual(parseAgentSignal('{"event":"stop","agent":"claude-code","ts":"x"}'), { event: 'stop', agent: 'claude-code' });
  assert.deepStrictEqual(parseAgentSignal('{"event":"start"}'), { event: 'start', agent: 'unknown agent' });
  assert.strictEqual(parseAgentSignal('{"event":"stop","agent":"<img src=x onerror=1>"}')!.agent, 'unknown agent');
  for (const bad of ['', 'stop', '{"event":"run"}', '[]', 'null', '{"event":"stop"' , `{"event":"stop","pad":"${'x'.repeat(3000)}"}`]) assert.strictEqual(parseAgentSignal(bad), undefined, bad);
});

test('tracking rules: excluded files always come with a reason; sensitive files are tracked but flagged', () => {
  assert.ok(globToRegExp('**/node_modules/**').test('a/node_modules/x/y.js'));
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules/x.js'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.deepStrictEqual(trackingDecision('src/app.py', rules), { track: true });
  assert.match(trackingDecision('web/dist/bundle.js', rules).reason!, /session\.exclude/);
  assert.match(trackingDecision('docs/a.md', { ...rules, include: ['src/**'] }).reason!, /session\.include/);
  assert.match(trackingDecision('a.rb', { ...rules, extensions: ['py', '.ts'] }).reason!, /extensions/);
  assert.ok(trackingDecision('a.TS', { ...rules, extensions: ['py', '.ts'] }).track);
  for (const p of ['.env', 'config/.env.production', 'deploy/key.pem', 'id_rsa', 'app/secrets.json']) {
    assert.ok(trackingDecision(p, rules).track, `${p} must still be tracked`);
    assert.ok(isSensitive(p, rules), `${p} must never be sent`);
  }
  assert.ok(!isSensitive('src/environment.ts', rules));
});

test('files are categorised: dependencies, migrations, tests, config, docs, source', () => {
  const cases: Record<string, string> = { 'package.json': 'dependency', 'backend/requirements-dev.txt': 'dependency', 'pyproject.toml': 'dependency',
    'migrations/0002_users.py': 'migration', 'db/schema.sql': 'migration', 'prisma/schema.prisma': 'migration', 'tests/test_auth.py': 'test',
    'src/auth.test.ts': 'test', 'tsconfig.json': 'config', '.github/workflows/ci.yml': 'config', 'Dockerfile': 'config', 'README.md': 'docs',
    'src/auth.py': 'source', 'web/Login.tsx': 'source', 'logo.png': 'other' };
  for (const [p, c] of Object.entries(cases)) assert.strictEqual(categorize(p), c, p);
});

test('a session survives a restart: serialisation round-trips and rejects corrupt data', () => {
  const s = session({ 'a.py': 'A' });
  observe(s, 'a.py', st('A1'), 5); s.skipped.push({ path: 'x', reason: 'r' });
  const back = deserialize(serialize(s))!;
  assert.deepStrictEqual(back, s);
  // after the restart a rescan reports what changed while the editor was closed
  observe(back, 'while-closed.py', st('W'), 9);
  assert.deepStrictEqual(effectiveChanges(back).map((c) => c.path), ['a.py', 'while-closed.py']);
  for (const bad of ['', '{', '{"version":2}', '{"version":1,"id":"x","baseline":{},"changes":{},"status":"hacked"}']) assert.strictEqual(deserialize(bad), undefined);
});

// ---------------------------------------------------------------- imports
test('local imports are resolved for JS/TS and Python; packages are ignored', () => {
  const paths = new Set(['src/api.ts', 'src/util.ts', 'src/lib/index.ts', 'src/data.json', 'app/__init__.py', 'app/models.py', 'app/auth.py', 'app/db/__init__.py', 'app/db/session.py', 'package.json', 'app/requirements.txt']);
  assert.deepStrictEqual(jsSpecifiers(`import a from './util';\nconst b = require("../x");\nexport * from './lib'; import('./lazy'); import 'react'; import y from "lodash";`).sort(), ['../x', './lazy', './lib', './util']);
  assert.deepStrictEqual(localImports('src/api.ts', `import { u } from './util.js';\nimport lib from './lib';\nimport d from './data.json';\nimport r from 'react';`, paths).sort(), ['src/data.json', 'src/lib/index.ts', 'src/util.ts']);
  assert.deepStrictEqual(pyImports('from .models import (User,\n    Token as T)\nimport os, app.db.session as s\nfrom . import models'), [
    { level: 1, module: 'models', names: ['User', 'Token'] }, { level: 0, module: 'os', names: [] }, { level: 0, module: 'app.db.session', names: [] }, { level: 1, module: '', names: ['models'] }]);
  assert.deepStrictEqual(localImports('app/auth.py', 'from .models import User\nfrom app.db import session\nimport requests\nfrom . import models\n', paths).sort(), ['app/db/__init__.py', 'app/db/session.py', 'app/models.py']);
  assert.deepStrictEqual(nearestManifests('src/api.ts', paths), ['package.json']);
  assert.deepStrictEqual(nearestManifests('app/db/session.py', paths), ['app/requirements.txt']);
  assert.deepStrictEqual(nearestManifests('README.md', paths), []);
});

test('unchanged importers of changed and deleted files are found', () => {
  const paths = new Set(['src/page.tsx', 'src/api.ts', 'src/other.ts']);
  assert.ok(importsAnyOf('src/page.tsx', `import { getUser } from './api';`, new Set(['src/api.ts']), paths, new Set()));
  assert.ok(importsAnyOf('src/page.tsx', `import { old } from './removed';`, new Set(), paths, new Set(['src/removed.ts'])), 'importer of a deleted file');
  assert.ok(!importsAnyOf('src/other.ts', `import x from './page';`, new Set(['src/api.ts']), paths, new Set()));
});

// ---------------------------------------------------------------- report
const F = (over: Partial<SessionFinding>): SessionFinding => ({ id: 'SEC-1', serverId: 'SEC-1', jobId: 'j', path: 'a.py', line: 3, severity: 'high', title: 'SQL injection risk',
  message: 'built with formatting', check: 'security', tool: 'semgrep', rule: 'sql', excerpt: 'conn.execute(q)', introduced: 'new', deterministic: true, crossFile: false, ...over });
const serverReport = (job: string, files: any[]) => ({ job_id: job, depth: 'standard', files, project_checks: [{ kind: 'imports', status: 'passed', summary: `s-${job}`, scope: 'sc' }],
  not_executed: [{ check: 'Project tests', reason: 'not run' }], disclaimer: 'D' });
const sf = (path: string, findings: any[], extra: any = {}) => ({ path, change: 'modified', analysed: true, checks: [{ kind: 'security', status: findings.length ? 'issues_found' : 'passed' }], findings, ...extra });
const raw = (id: string, rule: string, line: number, extra: any = {}) => ({ id, check: 'security', tool: 'semgrep', rule_id: rule, title: `T-${rule}`, message: 'm', severity: 'high',
  location: { line }, code_excerpt: `code-${rule}`, introduced: 'new', status: 'issue_detected', explained: { why: 'W', next_step: 'N' }, ...extra });

test('batches respect both limits, keep related files with their owner, and never drop a file silently', () => {
  const files = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}.py`, chars: 100, attach: i === 0 ? ['ctx.py', 'pkg.json'] : [] }));
  const { batches, oversized } = planBatches([...files, { path: 'huge.py', chars: 5000, attach: [] }], () => 50, { maxFiles: 4, maxChars: 1000 });
  assert.deepStrictEqual(oversized, ['huge.py']);
  assert.deepStrictEqual(batches.flatMap((b) => b.files).sort(), files.map((f) => f.path));
  assert.ok(batches.every((b) => b.files.length + b.attach.length <= 4));
  assert.deepStrictEqual(batches[0].attach, ['ctx.py', 'pkg.json']);
  // a changed file is never also listed as its own (or another's) context in the same batch
  const two = planBatches([{ path: 'a.py', chars: 10, attach: ['b.py'] }, { path: 'b.py', chars: 10, attach: ['a.py'] }], () => 10, { maxFiles: 10, maxChars: 1000 });
  assert.deepStrictEqual(two.batches, [{ files: ['a.py', 'b.py'], attach: [] }]);
});

test('merged report: unique ids, no duplicate findings for files shared between batches, honest counts', () => {
  const related = sf('shared.ts', [raw('IMP-1', 'import-of-deleted-file', 1, { tool: 'trustcode-imports', metadata: { cross_file: true } })], { change: 'related' });
  const m = mergeReports([
    serverReport('j1', [sf('a.py', [raw('SEC-1', 'sql', 3), raw('SEC-2', 'eval', 9, { introduced: 'preexisting' })]), related]),
    serverReport('j2', [sf('b.py', [raw('SEC-1', 'md5', 2, { status: 'needs_human_review', introduced: 'weird' })]), related,
      sf('c.sql', [], { analysed: false, reason: 'No code analyzer', checks: [] }), sf('gone.py', [], { change: 'deleted', analysed: false, reason: 'File was deleted', checks: [] })]),
  ]);
  assert.strictEqual(new Set(m.findings.map((f) => f.id)).size, m.findings.length);
  assert.strictEqual(m.findings.filter((f) => f.path === 'shared.ts').length, 1, 'a related file sent with two batches is reported once');
  assert.deepStrictEqual(m.origin, { new: 2, preexisting: 1, unknown: 1 });
  assert.strictEqual(m.findings.find((f) => f.rule === 'md5')!.deterministic, false);
  assert.deepStrictEqual([m.findings.find((f) => f.rule === 'md5')!.jobId, m.findings.find((f) => f.rule === 'md5')!.serverId], ['j2', 'SEC-1']);
  assert.strictEqual(m.filesChanged, 4);            // related/context files are not counted as changed
  assert.strictEqual(m.filesAnalysed, 2);
  assert.deepStrictEqual(m.notAnalysed.map((x) => x.path).sort(), ['c.sql', 'gone.py']);
  assert.deepStrictEqual(m.checks.security, { issues_found: 2 });
  assert.strictEqual(m.projectChecks[0].summary, 's-j1 · s-j2');
  assert.deepStrictEqual(m.jobIds, ['j1', 'j2']);
  assert.deepStrictEqual(mergeReports([]).findings, []);
});

test('comparing runs: a finding is "no longer reported" only if its file was checked again', () => {
  const run1 = mergeReports([serverReport('j1', [sf('a.py', [raw('SEC-1', 'sql', 3), raw('SEC-2', 'eval', 9)]), sf('b.py', [raw('SEC-3', 'md5', 1)])])]);
  const run2 = mergeReports([serverReport('j2', [sf('a.py', [raw('SEC-1', 'sql', 30), raw('SEC-2', 'pickle', 4)])])]);   // only a.py re-verified
  const c = compareRuns(run1, run2);
  assert.deepStrictEqual(c.noLongerReported.map((f) => f.rule), ['eval']);
  assert.deepStrictEqual(c.added.map((f) => f.rule), ['pickle']);
  assert.strictEqual(c.unchanged, 1, 'matched despite the line moving from 3 to 30');
  assert.deepStrictEqual(c.notRechecked.map((f) => f.path), ['b.py'], 'b.py was not in the second run: nothing is known');
});

test('a run is outdated when a verified file has different content now', () => {
  const run: any = { verified: { 'a.py': 'h1', 'b.py': 'h2', 'gone.py': 'deleted' } };
  assert.deepStrictEqual(outdatedFiles(run, (p) => ({ 'a.py': 'h1', 'b.py': 'h2-edited', 'gone.py': 'deleted' } as any)[p]), ['b.py']);
});

test('fix prompt: evidence only, scoped, pre-existing issues separated, review-only items marked', () => {
  const text = buildFixPrompt([F({}), F({ id: 'IMP-1', path: 'web/page.tsx', line: 1, title: '`getUser` is not exported by web/api.ts', tool: 'trustcode-imports', rule: 'imported-name-not-exported', nextStep: 'Export the name.' }),
    F({ id: 'PKG-1', deterministic: false, title: 'Package not declared' }), F({ id: 'SEC-9', introduced: 'preexisting', title: 'Old problem' })]);
  assert.match(text, /reported 3 issues/);
  assert.match(text, /a\.py:3 — SQL injection risk \[high\]/);
  assert.match(text, /Do not change unrelated functionality/);
  assert.match(text, /run the relevant tests/);
  assert.match(text, /flagged for human review, not a confirmed defect/);
  assert.ok(!text.includes('Old problem'));
  assert.match(text, /1 further issue was already present before these changes/);
  assert.match(buildFixPrompt([F({ introduced: 'preexisting', title: 'Old problem' })], { includePreexisting: true }), /Already present before these changes[\s\S]*Old problem/);
});

// ---------------------------------------------------------------- dashboard
const settings = { depth: 'standard', defaultScope: 'session', inactivitySeconds: 60, sendBaseline: true, includeRelated: true, batchSize: 10,
  auto: { agentFinished: true, inactivity: false, sessionEnd: true, save: false, batch: false } };
function dash(s?: ReturnType<typeof session>, over: Partial<DashboardModel> = {}): DashboardModel {
  return { hasWorkspace: true, session: s && { agent: s.agent, status: s.status, startedAt: s.startedAt, completion: s.completion, counts: counts(s), changes: effectiveChanges(s),
    skipped: s.skipped, warnings: s.warnings, baselineFiles: Object.keys(s.baseline).length, usesGit: false, recovered: false }, outdated: [], viewingOlderRun: false, history: [], settings, ...over };
}
const VERDICT = /\b(is safe|are safe|is secure|is correct|verified correct|no bugs|bug-free|all good)\b/i;

test('tabs; the dashboard explains tracking before a session and never needs a selection', () => {
  assert.deepStrictEqual(TABS, ['security', 'verify', 'session', 'history', 'account']);
  assert.match(page('session', true, 'x', ''), /data-tab="session"[^>]*>Session</);
  const html = sessionPage(dash());
  assert.match(html, /data-action="sessionStart"/);
  assert.match(html, /already have before starting are part of the baseline/);
  for (const a of ['verifyGit', 'verifyPick', 'verifyWorkspace']) assert.match(html, new RegExp(`data-action="${a}"`));
  assert.match(sessionPage(dash(undefined, { hasWorkspace: false })), /Open a folder/);
});

test('active session: counts, grouped file list with categories, every action present, paths escaped', () => {
  const s = session({ 'src/a.py': 'A', 'old.py': 'O', 'package.json': 'P' });
  observe(s, 'src/a.py', st('A1'), 1); observe(s, 'old.py', undefined, 1); observe(s, 'package.json', st('P1'), 1);
  observe(s, 'migrations/0002_<b>x</b>.sql', st('M'), 1); observe(s, 'tests/test_a.py', st('T'), 1);
  s.changes['src/a.py'].editedInEditor = true; s.changes['package.json'].verifiedHash = 'P1';
  s.skipped.push({ path: 'web/dist/app.js', reason: 'excluded by trustcode.session.exclude' });
  const html = sessionPage(dash(s));
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /New files <span class="muted">\(2\)/);
  assert.match(html, /Modified files <span class="muted">\(2\)/);
  assert.match(html, /Deleted files <span class="muted">\(1\)/);
  assert.match(html, /Includes 1 test · 1 dependencies · 1 migration \/ schema/);
  assert.match(html, /edited in editor/);
  assert.match(html, /1 file not tracked \(see why\)[\s\S]*web\/dist\/app\.js[\s\S]*session\.exclude/);
  assert.match(html, /Verify all changes \(5\)/);
  assert.match(html, /Verify unverified only \(4\)/);
  for (const a of ['sessionPause', 'sessionEnd', 'sessionEndVerify', 'sessionRescan', 'sessionVerifySelected', 'openDiff']) assert.match(html, new RegExp(`data-action="${a}"`), a);
  assert.strictEqual((changedFiles(dash(s)).match(/data-pick="/g) ?? []).length, 5);
  s.status = 'paused';
  assert.match(sessionPage(dash(s)), /data-action="sessionResume"/);
  s.status = 'ended';
  const ended = sessionPage(dash(s));
  assert.ok(!/data-action="session(Pause|Resume|End|Rescan)"/.test(ended));
  assert.match(ended, /Start a new session/);
  assert.match(sessionPage(dash(s, { busy: { message: 'Verifying…', done: 1, total: 3 } })), /<progress max="3" value="1"/);
});

test('report: severity groups, origin and source labels, not-executed and not-analysed lists, never a verdict', () => {
  const report = mergeReports([serverReport('j1', [sf('a.py', [raw('SEC-1', 'sql', 3, { severity: 'critical', title: '<script>x</script>' }), raw('SEC-2', 'eval', 9, { introduced: 'preexisting', severity: 'low' }),
    raw('PKG-1', 'undeclared', 1, { status: 'needs_human_review', introduced: 'unknown', severity: 'medium' })], { checks: [{ kind: 'security', status: 'check_failed' }] }),
    sf('schema.sql', [], { analysed: false, reason: 'No code analyzer for this file type', checks: [] })])]);
  const run: any = { id: 'aaaaaaaaaaaa', at: 1, finishedAt: 2, scope: 'session', depth: 'standard', trigger: 'inactivity', report, verified: {}, skipped: [{ path: '.env', reason: 'matches trustcode.session.sensitiveFiles: never sent' }] };
  const html = runReport(dash(undefined, { run, outdated: ['a.py'] }));
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /3 findings in 2 changed files/);
  assert.match(html, /1 new in this change · 1 already present before · 1 of unknown origin/);
  assert.match(html, /trigger: no changes for a while \(estimate\)/);
  for (const label of ['New in this change', 'Already present before', 'Origin unknown', 'Tool-confirmed', 'Needs human review']) assert.ok(html.includes(label), label);
  assert.match(html, /These results are out of date[\s\S]*1 file changed after this run read it/);
  assert.match(html, /Not executed \(1\)[\s\S]*Project tests/);
  assert.match(html, /Not analysed \(2\)[\s\S]*schema\.sql[\s\S]*\.env[\s\S]*never sent/);
  assert.match(html, /data-action="rerunFailed"[^>]*>Re-run failed checks \(1 file\)/);
  assert.match(html, /data-action="copyFixPrompt"/);
  assert.match(html, /data-action="openFinding" data-finding="SEC-1">a\.py:3/);
  assert.ok(!VERDICT.test(html), 'no verdict wording');
  const clean = runReport(dash(undefined, { run: { ...run, report: mergeReports([serverReport('j', [sf('a.py', [])])]), skipped: [] } }));
  assert.match(clean, /The checks reported no findings in 1 changed file/);
  assert.match(clean, /not proof that the change works/);
  assert.ok(!clean.includes('data-action="copyFixPrompt"') && !clean.includes('data-action="rerunFailed"'));
  assert.match(runReport(dash(undefined, { run: { ...run, cancelled: true } })), /cancelled before it finished/);
});

test('settings card: every control maps to a real setting; estimate wording is explicit', () => {
  const html = settingsCard(settings);
  for (const k of ['verification.depth', 'verification.defaultScope', 'autoVerify.onAgentFinished', 'autoVerify.onInactivity', 'autoVerify.onSessionEnd', 'autoVerify.onSave',
    'autoVerify.onBatch', 'verification.sendBaseline', 'verification.includeRelatedFiles']) assert.match(html, new RegExp(`data-action="setSetting" data-key="${k.replace('.', '\\.')}"`), k);
  assert.match(html, /An estimate: the agent may still be working/);
  assert.match(html, /Project tests are never run for multi-file changes/);
  assert.match(settingsCard({ ...settings, inactivitySeconds: 0 }), /Inactivity detection is off/);
});
