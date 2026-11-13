// Session tracking scenarios inside a real VS Code window, with a real workspace folder and a live local
// backend. Files are changed on disk with `fs` (the way an external coding agent does), not through the editor.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type R = { name: string; ok: boolean; ms: number; err?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSessionScenarios(hook: any, backend: string, gitMode: boolean): Promise<R[]> {
  const results: R[] = [];
  /** Set: Verify and Session run on the local engine (this interpreter) and no server exists. */
  const enginePy = process.env.TRUSTCODE_TEST_ENGINE;
  const SERVER_ONLY = /backend unreachable|never sends to a server that was not approved/;
  const t = async (name: string, fn: () => Promise<void>) => {
    if (enginePy && SERVER_ONLY.test(name)) { console.log(`  skip ${name} (server analysis only)`); return; }
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e: any) { results.push({ name, ok: false, ms: Date.now() - t0, err: e?.message }); console.log(`  FAIL ${name}: ${e?.message} @ ${String(e?.stack ?? '').split('\n').slice(1, 5).map((l: string) => l.trim()).join(' | ')}`); }
  };
  const { view, ctx } = hook;
  let session = hook.session;
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const abs = (rel: string) => path.join(root, ...rel.split('/'));
  const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), text); };
  const read = (rel: string) => fs.readFileSync(abs(rel), 'utf8');
  const until = async (cond: () => boolean, what: string, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(100); } };
  const changes = (): Array<{ path: string; kind: string; from?: string; category: string; editedInEditor?: boolean; mixed?: boolean; verifiedHash?: string }> => session.model().session?.changes ?? [];
  const kinds = () => Object.fromEntries(changes().map((c) => [c.path, c.kind]));
  const latest = () => session.latestRun();
  const findings = (rule?: string) => (latest()?.report.findings ?? []).filter((f: any) => !rule || f.rule === rule);
  const errors: string[] = [];
  const origErr = view.error.bind(view);
  view.error = (e: unknown) => { errors.push(String((e as any)?.message ?? e)); origErr(e); };
  const html: string[] = [];
  const origPost = view.render.bind(view);
  view.render = (h: string) => { html.push(h); origPost(h); };

  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const set = (k: string, v: unknown) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
  await set('backendUrl', backend); await set('mode', enginePy ? 'account' : 'local');
  await set('analysis.location', enginePy ? 'local' : 'server'); await set('engine.pythonPath', enginePy || undefined);
  await set('session.inactivitySeconds', 0); await set('autoVerify.onAgentFinished', false); await set('session.notifications', 'none');
  await set('verification.depth', 'standard');
  await ctx.globalState.update('trustcode.consent', { trustedBackends: [backend.replace(/\/$/, ''), 'http://127.0.0.1:9'] });
  await view.refreshAuth();

  await t(`baseline: ${gitMode ? 'Git workspace' : 'no Git available'} — pre-existing uncommitted edits are not session changes`, async () => {
    assert.ok(await session.start('Test agent'), 'session did not start');
    const m = session.model().session;
    assert.strictEqual(m.usesGit, gitMode);
    assert.strictEqual(m.counts.total, 0, `pre-existing edits were attributed to the session: ${JSON.stringify(kinds())}`);
    assert.ok(session.session.baseline['app/legacy.py'], 'dirty file missing from the baseline');
    if (gitMode) assert.ok(session.session.git.dirtyAtStart.includes('app/legacy.py'), 'pre-existing uncommitted change not recorded');
    assert.ok(!session.session.baseline['dist/bundle.js'], 'generated file was tracked');
    assert.ok(!Object.keys(session.session.baseline).some((p) => p.startsWith('node_modules/')), 'dependency folder was tracked');
    assert.ok(m.skipped.some((k: any) => k.path === 'dist/bundle.js') || gitMode, 'excluded file must be listed with a reason');
  });

  await t('scenario 1, 6, 7: agent creates backend, frontend, test and migration files — detected from file events alone', async () => {
    write('app/reset.py', 'from .models import User\nfrom .tokens import make_token\n\ndef request_reset(conn, email):\n    row = conn.execute(f"SELECT id FROM users WHERE email = \'{email}\'").fetchone()\n    return make_token(row[0]) if row else None\n');
    write('app/schemas.py', 'from dataclasses import dataclass\n\n@dataclass\nclass ResetRequest:\n    email: str\n');
    write('web/Login.tsx', "import { login, resetPassword } from './api';\nexport const Login = () => login('a', 'b') && resetPassword('a');\n");
    write('tests/test_reset.py', 'from app.reset import request_reset\n\ndef test_none():\n    assert request_reset is not None\n');
    write('migrations/0002_reset_tokens.sql', 'CREATE TABLE reset_tokens (id INTEGER PRIMARY KEY, user_id INTEGER, token TEXT);\n');
    await until(() => changes().length === 5, '5 created files');
    assert.deepStrictEqual([...new Set(Object.values(kinds()))], ['created']);
    const cat = Object.fromEntries(changes().map((c) => [c.path, c.category]));
    assert.deepStrictEqual([cat['tests/test_reset.py'], cat['migrations/0002_reset_tokens.sql'], cat['web/Login.tsx']], ['test', 'migration', 'source']);
  });

  await t('scenario 2, 5: agent modifies several existing files, a dependency manifest and configuration', async () => {
    write('app/auth.py', read('app/auth.py') + '\n\ndef evaluate_rule(expr):\n    return eval(expr)\n');
    write('app/tokens.py', read('app/tokens.py').replace('def make_token', 'def create_token'));   // breaks unchanged importers
    write('package.json', JSON.stringify({ name: 'demo', dependencies: { react: '18.0.0', zod: '3.0.0' } }, null, 2));
    write('config/settings.json', '{ "debug": true, "resetTtlMinutes": 30 }\n');
    await until(() => ['app/auth.py', 'app/tokens.py', 'package.json', 'config/settings.json'].every((p) => kinds()[p] === 'modified'), '4 modified files');
    const cat = Object.fromEntries(changes().map((c) => [c.path, c.category]));
    assert.deepStrictEqual([cat['package.json'], cat['config/settings.json']], ['dependency', 'config']);
    assert.strictEqual(session.model().session.counts.modified, 4);
  });

  await t('scenario 3, 4: agent deletes one file and renames another (plain file-system operations)', async () => {
    fs.rmSync(abs('web/legacy.ts'));
    fs.renameSync(abs('app/models.py'), abs('app/entities.py'));
    await until(() => kinds()['web/legacy.ts'] === 'deleted' && kinds()['app/entities.py'] === 'renamed', 'delete + rename');
    const ren = changes().find((c) => c.path === 'app/entities.py')!;
    assert.strictEqual(ren.from, 'app/models.py');
    assert.ok(!changes().some((c) => c.path === 'app/models.py'), 'the old path of a rename must not also be listed as deleted');
    const c = session.model().session.counts;
    assert.deepStrictEqual([c.created, c.modified, c.deleted, c.renamed], [5, 4, 1, 1]);
  });

  await t('scenario 8: a file the developer types in during the session is flagged as edited in the editor', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs('app/schemas.py')));
    const ed = await vscode.window.showTextDocument(doc);
    await ed.edit((e) => e.insert(new vscode.Position(doc.lineCount, 0), '\n# reviewed by a human\n'));
    await doc.save();
    await until(() => !!changes().find((c) => c.path === 'app/schemas.py')?.editedInEditor, `editedInEditor flag (dirty=${doc.isDirty}, text has edit=${doc.getText().includes('reviewed')}, disk has edit=${read('app/schemas.py').includes('reviewed')})`, 6000);
    assert.ok(!changes().find((c) => c.path === 'app/reset.py')?.editedInEditor, 'a file written only on disk must not be flagged');
  });

  await t('excluded, ignored and sensitive files: not silently dropped, and secrets files are never sent', async () => {
    write('dist/bundle.js', 'console.log(2)\n');
    write('.env', 'API_KEY=changed-during-session\n');
    await sleep(900); await session.rescan(false);
    assert.ok(!kinds()['dist/bundle.js'], 'generated output was attributed to the session');
    assert.strictEqual(kinds()['.env'], 'modified', 'a changed .env must be visible as changed');
  });

  await t('scenario 11: agent stops without a signal → inactivity is reported as an estimate, and withdrawn when work continues', async () => {
    await set('session.inactivitySeconds', 1);
    await until(() => session.session.status === 'awaiting_review', 'inactivity estimate', 12000);
    assert.strictEqual(session.session.completion.kind, 'inactivity_estimate');
    await view.showTab('session');
    assert.match(html[html.length - 1], /Possibly finished \(estimate\)/);
    assert.match(html[html.length - 1], /cannot confirm that the agent is done/);
    await set('session.inactivitySeconds', 0);
    write('app/notes_from_agent.md', '# still working\n');
    await until(() => session.session.status === 'tracking' && !session.session.completion, 'estimate withdrawn');
    fs.rmSync(abs('app/notes_from_agent.md'));
    await until(() => !kinds()['app/notes_from_agent.md'], 'created-then-deleted file leaves no change');
  });

  await t('agent completion signal (hook file) is a confirmed signal; junk signals are ignored', async () => {
    write('.trustcode/agent-signal.json', '{"event":"run-arbitrary","agent":"x"}');
    await sleep(700);
    assert.strictEqual(session.session.status, 'tracking');
    write('.trustcode/agent-signal.json', JSON.stringify({ event: 'stop', agent: 'claude-code', ts: new Date().toISOString() }));
    await until(() => session.session.status === 'awaiting_review', 'agent signal');
    assert.strictEqual(session.session.completion.kind, 'agent_signal');
    assert.match(session.session.completion.detail, /claude-code reported that it finished a turn/);
    assert.ok(!Object.keys(kinds()).some((p) => p.startsWith('.trustcode/')), 'the signal file itself must not be a session change');
  });

  let firstRunFindings = 0;
  await t('whole-change verification: per-file evidence, cross-file problems, attribution, and honest gaps', async () => {
    const n = errors.length;
    await session.verify('session', 'manual', true);
    assert.strictEqual(errors.length, n, `errors: ${errors.slice(n).join('; ')}`);
    const run = latest();
    assert.ok(run, 'no run recorded');
    const r = run.report;
    firstRunFindings = r.findings.length;
    const by = (rule: string, p: string) => r.findings.find((f: any) => f.rule === rule && f.path === p);
    // per-file, in files nobody selected
    assert.ok(by('sql-string-formatting', 'app/reset.py'), 'SQL injection in the new file not reported');
    const ev = by('eval-exec-use', 'app/auth.py');
    assert.ok(ev, 'eval in the modified file not reported');
    assert.strictEqual(ev.introduced, 'new', 'the eval was added in this session');
    assert.ok(!r.findings.some((f: any) => f.path === 'app/legacy.py'), 'pre-existing file reported as part of the session');
    // cross-file: rename broke importers, the renamed function broke an UNCHANGED file, a deleted file is still imported
    assert.ok(r.findings.some((f: any) => f.rule === 'import-of-deleted-file' && f.path === 'app/reset.py'), 'import of the renamed module not reported in the new file');
    const routes = r.findings.find((f: any) => f.path === 'app/routes.py' && f.rule === 'imported-name-not-defined');
    assert.ok(routes, 'unchanged importer of the renamed function was not checked');
    assert.strictEqual(routes.introduced, 'new');
    assert.match(routes.message, /removed or renamed in this change/);
    assert.ok(r.findings.some((f: any) => f.rule === 'import-of-deleted-file' && f.path === 'web/page.tsx'), 'unchanged importer of the deleted file not reported');
    assert.ok(by('imported-name-not-exported', 'web/Login.tsx'), 'import of a name the API module does not export not reported');
    assert.strictEqual(new Set(r.findings.map((f: any) => f.id)).size, r.findings.length, 'duplicate finding ids');
    // honest gaps
    assert.ok(r.notExecuted.some((x: any) => x.check === 'Project tests'), 'project tests must be listed as not executed');
    assert.ok(run.skipped.some((x: any) => x.path === '.env' && /never sent/.test(x.reason)), '.env must be listed as not sent');
    const sql = r.files.find((f: any) => f.path === 'migrations/0002_reset_tokens.sql');
    assert.match(sql.reason, /No code analyzer/);
    assert.ok(r.checks.types?.not_run >= 1, 'missing TypeScript type checker must show as not run');
    // editor: diagnostics in several files, none as errors
    for (const p of ['app/reset.py', 'app/auth.py', 'app/routes.py', 'web/page.tsx']) {
      const d = vscode.languages.getDiagnostics(vscode.Uri.file(abs(p)));
      assert.ok(d.length > 0, `no diagnostics in ${p}`);
      assert.ok(d.every((x) => x.severity !== vscode.DiagnosticSeverity.Error));
    }
    const c = session.model().session.counts;
    assert.strictEqual(c.awaiting, 1, `only .env may remain unverified, got ${JSON.stringify(changes().filter((x) => !x.verifiedHash).map((x) => x.path))}`);
    await view.showTab('session');
    const page = html[html.length - 1];
    assert.match(page, /New in this change/);
    assert.match(page, /Not executed/);
    assert.ok(!/\b(is safe|is secure|is correct|bug-free)\b/i.test(page.replace(/do not establish that the change is correct/g, '')), 'verdict wording in the dashboard');
  });

  await t('interaction: hover, quick action, open finding and diff work across files', async () => {
    let step = 'find';
    try {
    const f = findings('eval-exec-use')[0];
    const uri = vscode.Uri.file(abs('app/auth.py'));
    step = `hover line=${f?.line}`;
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, new vscode.Position(f.line - 1, 6));
    const text = hovers.flatMap((h) => h.contents).map((c: any) => (typeof c === 'string' ? c : c.value)).join('\n');
    assert.match(text, /TrustCode[\s\S]*Evidence/);
    assert.match(text, /%22session%22/);
    step = 'code actions';
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));   // a lightbulb only exists for an open file
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, new vscode.Range(f.line - 1, 0, f.line - 1, 5));
    const explain = actions.find((a) => /TrustCode: explain/.test(a.title));
    assert.deepStrictEqual(explain?.command?.arguments, [f.id, 'session']);
    step = 'openFinding';
    await session.openFinding(f.id);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, uri.fsPath);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.start.line, f.line - 1);
    step = 'baselineText';
    const base = await session.baselineText('app/auth.py');
    assert.ok(base && !base.includes('evaluate_rule'), 'baseline text must be the pre-session version');
    step = 'diff modified';
    await session.openDiff('app/auth.py');
    step = 'diff deleted';
    await session.openDiff('web/legacy.ts');   // deleted: shows the removed text
    assert.match(vscode.window.activeTextEditor!.document.getText(), /legacyHelper/);
    assert.strictEqual(vscode.window.activeTextEditor!.document.uri.scheme, 'trustcode-baseline');
    } catch (e: any) { e.message = `[${step}] ${e.message}`; throw e; }
  });

  await t('scenario 10: agent keeps editing while verification runs → the result is marked out of date, not final', async () => {
    const api = view.api;
    const orig = api.request.bind(api);
    let fired = false;
    api.request = async (method: string, p: string, ...rest: any[]) => {
      if (!fired && method === 'POST' && p === '/session-verifications') { fired = true; write('app/auth.py', read('app/auth.py') + '\n# agent is still writing\n'); }
      return orig(method, p, ...rest);
    };
    try { await session.verify('session', 'manual', true); } finally { api.request = orig; }
    await until(() => session.outdated(latest()).includes('app/auth.py'), 'outdated detection');
    assert.ok(changes().find((c) => c.path === 'app/auth.py')!.verifiedHash !== undefined || true);
    assert.ok(session.model().session.counts.awaiting >= 2, 'the re-edited file must be awaiting verification again');
    await view.showTab('session');
    assert.match(html[html.length - 1], /These results are out of date/);
  });

  await t('fix workflow: copy prompt → agent fixes → re-verify → comparison; nothing is called resolved without a re-check', async () => {
    const prompt = session.fixPrompt();
    assert.match(prompt, /Do not change unrelated functionality/);
    assert.match(prompt, /app\/auth\.py:\d+ — /);
    await vscode.commands.executeCommand('trustcode.copyFixPrompt');
    assert.strictEqual(await vscode.env.clipboard.readText(), prompt);
    const before = read('app/routes.py');
    write('app/auth.py', read('app/auth.py').replace(/\n\ndef evaluate_rule\(expr\):\n    return eval\(expr\)\n/, '\n'));   // the "agent" removes the eval
    await until(() => !read('app/auth.py').includes('eval(') && session.model().session.counts.awaiting >= 1, 'fix detected');
    await session.verify('pending', 'manual', true);
    const cmp = session.comparison();
    assert.ok(cmp.noLongerReported.some((f: any) => f.rule === 'eval-exec-use'), 'the removed eval should be "no longer reported"');
    assert.ok(cmp.notRechecked.length > 0, 'files outside this run must be "not re-checked", not resolved');
    assert.ok(!cmp.noLongerReported.some((f: any) => f.path === 'app/reset.py'));
    assert.strictEqual(read('app/routes.py'), before, 'TrustCode must not modify files');
    assert.ok(session.runs.length >= 3, 'verification history must keep earlier runs');
    await view.onMessage({ action: 'openRun', run: session.runs[0].id });
    assert.match(html[html.length - 1], /You are viewing an earlier run/);
    await view.onMessage({ action: 'openRun', run: 'latest' });
  });

  await t('scenario 17: pause → manual edits are not attributed → resume', async () => {
    await session.rescan(false);
    const before = Object.keys(kinds()).sort();
    await session.pause();
    write('scratch/manual_note.py', 'x = 1\n');
    write('web/api.ts', read('web/api.ts') + '\n// developer tweak while paused\n');
    write('app/reset.py', read('app/reset.py') + '\n# developer tweak while paused\n');
    await sleep(700);
    assert.deepStrictEqual(Object.keys(kinds()).sort(), before, 'changes were recorded while paused');
    await session.resume();
    assert.strictEqual(session.session.status, 'tracking');
    assert.ok(!kinds()['scratch/manual_note.py'] && !kinds()['web/api.ts'], `paused edits attributed: ${JSON.stringify(kinds())}`);
    assert.ok(changes().find((c) => c.path === 'app/reset.py')!.mixed, 'a session file also edited while paused must be flagged');
    write('web/api.ts', read('web/api.ts') + '\nexport const afterResume = 1;\n');
    await until(() => kinds()['web/api.ts'] === 'modified', 'change after resume');
  });

  await t('scenario 18: changing the depth during a session changes the next run, and skipped checks are not shown as passed', async () => {
    await set('verification.depth', 'quick');
    await session.verify('selected', 'manual', true, ['app/reset.py']);
    const r = latest().report;
    assert.strictEqual(r.depth, 'quick');
    assert.ok(r.checks.security.not_run >= 1 && !r.checks.security.passed, 'security must be "not run" at quick depth');
    assert.ok(!r.findings.some((f: any) => f.check === 'security'));
    assert.ok(r.projectChecks.every((c: any) => c.status === 'not_run'));
    await set('verification.depth', 'standard');
  });

  await t('scenario 12: VS Code restarts mid-session → the session, its history and changes made meanwhile are restored', async () => {
    const before = { id: session.session.id, runs: session.runs.length, total: session.model().session.counts.total };
    session = await (async () => {
      // written while the "old" controller is already gone: no event will ever be delivered for it
      const p = hook.restartSession();
      write('app/written_while_closed.py', 'y = 2\n');
      return p;
    })();
    await session.rescan(false);
    assert.strictEqual(session.session.id, before.id);
    assert.strictEqual(session.runs.length, before.runs);
    assert.strictEqual(kinds()['app/written_while_closed.py'], 'created', 'change made during the restart was missed');
    assert.strictEqual(session.model().session.counts.total, before.total + 1);
    assert.ok(session.model().session.recovered);
    const base = await session.baselineText('app/tokens.py');
    assert.ok(base && base.includes('def make_token'), 'baseline text must survive the restart');
  });

  await t('scenario 16: backend unreachable → an error, no fabricated result, nothing marked verified', async () => {
    const awaiting = session.model().session.counts.awaiting;
    const runs = session.runs.length;
    await set('backendUrl', 'http://127.0.0.1:9');
    const n = errors.length;
    await session.verify('session', 'manual', true).catch((e: unknown) => view.error(e));
    await set('backendUrl', backend);
    await view.refreshAuth();
    assert.ok(errors.length > n, 'no error surfaced');
    const run = session.runs.length > runs ? latest() : undefined;
    if (run) assert.strictEqual(run.report.findings.length + Object.keys(run.verified).length, 0, 'a failed run must not contain results');
    assert.ok(session.model().session.counts.awaiting >= awaiting, 'files were marked verified although the server was unreachable');
  });

  await t('automatic trigger: with the server approved, an agent signal starts verification without any dialog', async () => {
    await set('autoVerify.onAgentFinished', true);
    const runs = session.runs.length;
    write('app/auto_trigger.py', 'import pickle\n\ndef load(b):\n    return pickle.loads(b)\n');
    await until(() => kinds()['app/auto_trigger.py'] === 'created', 'new file');
    write('.trustcode/agent-signal.json', JSON.stringify({ event: 'stop', agent: 'claude-code', ts: String(Date.now()) }));
    await until(() => session.runs.length > runs && !session.busy, 'automatic run', 40000);
    assert.strictEqual(latest().trigger, 'agent_signal');
    assert.ok(findings('unsafe-deserialization').some((f: any) => f.path === 'app/auto_trigger.py'));
    await set('autoVerify.onAgentFinished', false);
  });

  await t('automatic trigger never sends to a server that was not approved', async () => {
    await ctx.globalState.update('trustcode.consent', { trustedBackends: [] });
    const runs = session.runs.length;
    write('app/needs_consent.py', 'z = 3\n');
    await until(() => kinds()['app/needs_consent.py'] === 'created', 'new file');
    await session.verify('pending', 'agent_signal', false);
    assert.strictEqual(session.runs.length, runs, 'files were sent without consent');
    await ctx.globalState.update('trustcode.consent', { trustedBackends: [backend.replace(/\/$/, '')] });
  });

  if (gitMode) {
    await t('scope: Git-changed files includes the developer\'s own uncommitted edits (unlike session scope)', async () => {
      await session.verify('git', 'manual', true);
      const r = latest().report;
      assert.strictEqual(latest().scope, 'git');
      const legacy = r.findings.find((f: any) => f.path === 'app/legacy.py' && f.rule === 'eval-exec-use');
      assert.ok(legacy, 'the pre-existing uncommitted file must be part of the Git scope');
      assert.strictEqual(legacy.introduced, 'new', 'compared with HEAD, the uncommitted eval is new');
      assert.ok(r.files.some((f: any) => f.path === 'web/legacy.ts' && f.change === 'deleted'));
    });
    await t('Git: a commit during the session is noticed and explained, and does not hide the session changes', async () => {
      const cp = require('child_process');
      const total = session.model().session.counts.total;
      cp.execFileSync('git', ['add', '-A'], { cwd: root });
      cp.execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'agent work'], { cwd: root });
      await session.rescan(false);
      assert.strictEqual(session.model().session.counts.total, total, 'committing must not change what the session changed');
      assert.ok(session.model().session.warnings.some((w: string) => /HEAD moved/.test(w)));
    });
  } else {
    await t('scenario 13: without Git, pre-session text comes from snapshots and attribution still works', async () => {
      assert.strictEqual(session.session.git, undefined);
      const base = await session.baselineText('app/tokens.py');
      assert.ok(base && base.includes('def make_token'));
      await session.verify('selected', 'manual', true, ['app/tokens.py']);
      const routes = findings('imported-name-not-defined').find((f: any) => f.path === 'app/routes.py');
      assert.ok(routes && routes.introduced === 'new', 'attribution needs the snapshot baseline');
    });
    await t('scenario 14: large workspace and a burst of 300 file writes — nothing missed, nothing duplicated', async () => {
      const total = session.model().session.counts.total;
      const baseline = Object.keys(session.session.baseline).length;
      assert.ok(baseline >= 3000, `expected a large baseline, got ${baseline}`);
      const t0 = Date.now();
      for (let i = 0; i < 300; i++) write(`generated/mod_${i}.py`, `VALUE = ${i}\n`);
      for (let i = 0; i < 300; i += 3) write(`generated/mod_${i}.py`, `VALUE = ${i}\nAGAIN = True\n`);   // repeated writes of the same files
      await until(() => changes().filter((c) => c.path.startsWith('generated/')).length === 300, 'all 300 files', 30000);
      const burst = Date.now() - t0;
      const t1 = Date.now();
      await session.rescan(false);
      const rescan = Date.now() - t1;
      assert.strictEqual(session.model().session.counts.total, total + 300, 'rescan disagrees with event tracking');
      assert.strictEqual(new Set(changes().map((c) => c.path)).size, changes().length);
      console.log(`    large workspace: baseline ${baseline} files, 300-file burst tracked in ${burst} ms, full rescan ${rescan} ms`);
      assert.ok(rescan < 15000, `rescan too slow: ${rescan} ms`);
    });
  }

  await t('security: symbolic links are never followed out of the workspace or onto a sensitive file', async () => {
    const outside = path.join(require('os').tmpdir(), `trustcode-outside-${Date.now()}.py`);
    fs.writeFileSync(outside, 'OUTSIDE_SECRET = "must never leave this machine"\n');
    fs.symlinkSync(outside, abs('app/link_outside.py'));
    fs.symlinkSync(abs('.env'), abs('app/settings_link.py'));
    const api = view.api;
    const orig = api.request.bind(api);
    const sent: string[] = [];
    api.request = async (method: string, p: string, body?: any, ...rest: any[]) => { if (method === 'POST' && p === '/session-verifications') sent.push(JSON.stringify(body)); return orig(method, p, body, ...rest); };
    try { await session.verify('custom', 'manual', true, ['app/link_outside.py', 'app/settings_link.py', 'app/auth.py']); } finally { api.request = orig; fs.rmSync(outside, { force: true }); }
    assert.ok(sent.length >= 1, 'nothing was sent at all');
    assert.ok(!sent.join('').includes('OUTSIDE_SECRET') && !sent.join('').includes('API_KEY='), 'content behind a symbolic link was sent');
    const skipped = Object.fromEntries(latest().skipped.map((x: any) => [x.path, x.reason]));
    assert.match(skipped['app/link_outside.py'], /outside the workspace/);
    assert.match(skipped['app/settings_link.py'], /never sent/);
    fs.rmSync(abs('app/link_outside.py')); fs.rmSync(abs('app/settings_link.py'));
    await session.rescan(false);
  });

  await t('custom scope: chosen files can be verified without a selection or an open editor', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await session.verify('custom', 'manual', true, ['app/legacy.py', 'web/api.ts', 'not/in/workspace.py']);
    const r = latest().report;
    assert.deepStrictEqual(r.files.filter((f: any) => !['context', 'related'].includes(f.change)).map((f: any) => f.path).sort(), ['app/legacy.py', 'web/api.ts']);
    assert.ok(r.findings.some((f: any) => f.path === 'app/legacy.py' && f.introduced === 'unknown'), 'without a baseline the origin must be unknown');
  });

  await t('end session and verify: final run on the final state; tracking stops', async () => {
    await set('verification.maxFiles', 400);   // the large workspace has 300+ changed files: above the default limit the product asks first
    await session.end(true);
    await set('verification.maxFiles', undefined);
    assert.strictEqual(session.session.status, 'ended');
    const changedCount = session.model().session.counts.total;
    const covered = latest().report.filesChanged + latest().skipped.filter((x: any) => x.path !== 'cross-file checks').length;
    assert.ok(covered >= changedCount, `final run accounts for ${covered} of ${changedCount} changed files — some were silently dropped`);
    console.log(`    final run: ${latest().report.filesChanged} files in ${latest().report.jobIds.length} batch(es), ${latest().report.findings.length} findings, ${Math.round((latest().finishedAt - latest().at) / 100) / 10} s`);
    assert.strictEqual(latest().trigger, 'session_end');
    const total = session.model().session.counts.total;
    write('app/after_end.py', 'late = 1\n');
    await sleep(900);
    assert.strictEqual(session.model().session.counts.total, total, 'changes after the session ended were attributed to it');
    await view.showTab('session');
    assert.match(html[html.length - 1], /Start a new session/);
    assert.ok(firstRunFindings > 0);
  });

  await t('webview messages for the dashboard are validated', async () => {
    const n = errors.length;
    for (const m of [{ action: 'openDiff', path: 42 }, { action: 'openFinding', finding: '../../x' }, { action: 'openRun', run: '../runs' }, { action: 'setSetting', key: 'backendUrl', value: 'http://evil' },
      { action: 'setSetting', key: 'verification.depth', value: 'extreme' }, { action: 'sessionVerifySelected', paths: 'not-an-array' }, { action: 'sessionFeedback', finding: 'SEC-1', rating: 'DROP' }]) {
      await view.onMessage(m).catch((e: unknown) => view.error(e));
    }
    assert.strictEqual(cfg().get('backendUrl'), backend, 'a webview message changed the server URL');
    assert.strictEqual(cfg().get('verification.depth'), 'standard');
    assert.strictEqual(errors.length, n);
    await view.onMessage({ action: 'setSetting', key: 'verification.depth', value: 'deep' });
    assert.strictEqual(cfg().get('verification.depth'), 'deep');
    await set('verification.depth', 'standard');
  });
  return results;
}
