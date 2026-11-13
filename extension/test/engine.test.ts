import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/api';
import { emptyState, EngineRunner, LocalAnalysis, LocalState, MAX_RESULTS, readState, RoutedApi, toStored } from '../src/engine/local';
import { parseAnswer, parsePythonVersion, pythonOk, venvPaths } from '../src/engine/util';
import { account, engineNotice, privacyStatus, verifyForm } from '../src/ui';

const RESULT = { language: 'python', checks: [{ kind: 'security', findings: [{ id: 'SEC-1', tool: 'semgrep', rule_id: 'eval', severity: 'high' }] }] };

function setup(opts: { fail?: boolean; hang?: boolean; state?: LocalState } = {}) {
  const calls: any[] = [];
  let saved: LocalState | undefined = opts.state;
  let killed = 0;
  const engine: EngineRunner = {
    run: (req, o) => {
      calls.push(req);
      if (opts.hang) return new Promise((_, reject) => o?.onStart?.(() => { killed++; reject(new ApiError(0, 'engine_stopped', 'stopped')); }));
      if (opts.fail) return Promise.reject(new ApiError(500, 'engine', 'The local engine could not complete the analysis (boom). No result is shown.'));
      if (req.op === 'verify') return Promise.resolve({ ok: true, result: RESULT, view: { level: 'intermediate', findings: [{ finding_id: 'SEC-1' }] } });
      if (req.op === 'explain') return Promise.resolve({ ok: true, view: { level: req.level ?? req.selected_level, findings: [{ finding_id: 'SEC-1' }], n: calls.length } });
      return Promise.resolve({ ok: true, report: { kind: 'session', files: [{ path: 'a.py', findings: [{ id: 'SEC-1', tool: 'semgrep', rule_id: 'sqli' }] }] } });
    },
  };
  const local = new LocalAnalysis(engine, { load: () => saved, save: (s) => { saved = JSON.parse(JSON.stringify(s)); } },
    () => ({ profile: 'extended', registry: false, runTests: true }));
  return { local, calls, saved: () => saved, killed: () => killed };
}

test('verify: runs the engine with the code as data and returns the same shapes as the server', async () => {
  const { local, calls, saved } = setup();
  const job = await local.submit('x = eval(y)\n', 'python', 'task', undefined);
  assert.equal(job.status, 'running');
  const done = await local.waitForResult(job.id, () => false);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, RESULT);
  assert.equal(calls[0].op, 'verify');
  assert.equal(calls[0].code, 'x = eval(y)\n');
  assert.equal(calls[0].registry, false, 'no network lookup unless the user switched it on');
  assert.equal(calls[0].run_tests, false, 'no tests supplied: nothing is executed');
  const view = await local.request('GET', `/verifications/${job.id}/explanation?level=beginner`);
  assert.equal(view.level, 'beginner');
  const page = await local.request('GET', '/verifications?limit=25');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].status, 'done');
  assert.equal(page.items[0].result, undefined, 'the list carries no results');
  assert.equal(saved()!.jobs.length, 1, 'history is persisted');
});

test('tests are only executed when supplied and the setting allows it', async () => {
  const { local, calls } = setup();
  const job = await local.submit('def f(): return 1', 'python', undefined, 'def test_f(): pass');
  await local.waitForResult(job.id, () => false);
  assert.equal(calls[0].run_tests, true);
});

test('an engine failure is a failed job, never a result', async () => {
  const { local } = setup({ fail: true });
  const job = await local.submit('x = 1', 'python', undefined, undefined);
  const done = await local.waitForResult(job.id, () => false);
  assert.equal(done.status, 'failed');
  assert.equal(done.result, undefined);
  assert.match(done.error, /No result is shown/);
  await assert.rejects(local.request('GET', `/verifications/${job.id}/explanation`), (e: any) => e instanceof ApiError && e.status === 409);
});

test('cancel stops the engine process and records nothing as done', async () => {
  const { local, killed } = setup({ hang: true });
  const job = await local.submit('x = 1', 'python', undefined, undefined);
  let n = 0;
  const done = await local.waitForResult(job.id, () => ++n > 1);
  assert.equal(done.status, 'cancelled');
  assert.equal(killed(), 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await local.request('GET', `/verifications/${job.id}`)).status, 'cancelled');
});

test('feedback is stored locally by rule and sent back to the engine as view options', async () => {
  const { local, calls } = setup();
  const job = await local.submit('x = eval(y)', 'python', undefined, undefined);
  await local.waitForResult(job.id, () => false);
  await local.request('POST', '/feedback', { job_id: job.id, finding_id: 'SEC-1', rating: 'incorrect' });
  await local.request('POST', '/feedback', { job_id: job.id, finding_id: 'SEC-1', rating: 'incorrect' });
  await assert.rejects(local.request('POST', '/feedback', { job_id: job.id, finding_id: 'SEC-1', rating: 'made-up' }));
  await local.request('GET', `/verifications/${job.id}/explanation`);
  const explain = calls.find((c) => c.op === 'explain');
  assert.deepEqual(explain.rule_ratings, [['semgrep:eval', 'incorrect'], ['semgrep:eval', 'incorrect']]);
  assert.equal(local.counts().feedback, 2);
});

test('the explanation is cached per level and refreshed when feedback or the profile changes', async () => {
  const { local, calls } = setup();
  const job = await local.submit('x = 1', 'python', undefined, undefined);
  await local.waitForResult(job.id, () => false);
  const explains = () => calls.filter((c) => c.op === 'explain').length;
  await local.request('GET', `/verifications/${job.id}/explanation`);
  await local.request('GET', `/verifications/${job.id}/explanation`);
  assert.equal(explains(), 1);
  await local.request('PATCH', '/profile', { experience_level: 'advanced' });
  await local.request('GET', `/verifications/${job.id}/explanation`);
  assert.equal(explains(), 2);
  assert.equal(calls.filter((c) => c.op === 'explain')[1].selected_level, 'advanced');
});

test('profile: only known values are accepted; AI wording is never available locally', async () => {
  const { local } = setup();
  const p = await local.request('PATCH', '/profile', { experience_level: 'wizard', store_history: 'yes', allow_llm: true, adaptive_suggestions: false });
  assert.equal(p.experience_level, 'intermediate');
  assert.equal(p.store_history, true);
  assert.equal(p.adaptive_suggestions, false);
  assert.equal(p.allow_llm, false);
  assert.equal(p.llm_available, false);
});

test('session: files are analysed in one local request and the report is returned', async () => {
  const { local, calls } = setup();
  const job = await local.request('POST', '/session-verifications', { files: [{ path: 'a.py', change: 'modified', content: 'a\nb\n' }, { path: 'b.py', change: 'context', content: 'c' }],
    workspace_paths: ['a.py', 'b.py'], depth: 'deep', label: 'run', client_consent: true });
  const done = await local.waitForResult(job.id, () => false);
  assert.equal(done.status, 'done');
  assert.equal(calls[0].op, 'session');
  assert.equal(calls[0].request.depth, 'deep');
  assert.equal(calls[0].request.client_consent, undefined);
  assert.equal(calls[0].registry, false, 'a deep check cannot switch network lookups on by itself');
  const report = await local.request('GET', `/verifications/${job.id}/session-report`);
  assert.equal(report.kind, 'session');
  assert.equal(report.job_id, job.id);
  await local.request('POST', '/feedback', { job_id: job.id, finding_id: 'SEC-1', rating: 'helpful' });
  assert.equal(local.counts().feedback, 1);
});

test('clear removes history, feedback and the profile', async () => {
  const { local, saved } = setup();
  const job = await local.submit('x = 1', 'python', undefined, undefined);
  await local.waitForResult(job.id, () => false);
  await local.request('POST', '/feedback', { rating: 'helpful' });
  local.clear();
  assert.deepEqual(saved(), emptyState());
  await assert.rejects(local.request('GET', `/verifications/${job.id}`), (e: any) => e.status === 404);
});

test('stored state: history off stores no runs; old results are dropped; a corrupt file is not trusted', () => {
  const s = emptyState();
  s.jobs = Array.from({ length: 40 }, (_, i) => ({ id: `j${i}`, status: 'done' as const, code_lines: 1, created_at: 'now', result: RESULT }));
  const stored = toStored(s);
  assert.equal(stored.jobs.filter((j) => j.result).length, MAX_RESULTS);
  s.profile.store_history = false;
  assert.equal(toStored(s).jobs.length, 0);
  assert.deepEqual(readState('nonsense'), emptyState());
  assert.deepEqual(readState({ version: 2, jobs: [], feedback: [], profile: {} }), emptyState());
  const back = readState({ version: 1, jobs: [{ id: 'a', status: 'running', created_at: 'now', code_lines: 1 }, { nope: 1 }], feedback: [{ rating: 'incorrect', at: 1 }, { rating: 'x' }],
    profile: { experience_level: 'root', store_history: false, adaptive_suggestions: true } });
  assert.equal(back.jobs.length, 1);
  assert.equal(back.jobs[0].status, 'failed', 'a run that never finished is not shown as running or done');
  assert.equal(back.feedback.length, 1);
  assert.equal(back.profile.experience_level, 'intermediate');
  assert.equal(back.profile.store_history, false);
});

test('routing: local selection sends verification paths to the engine and nothing to the network', async () => {
  let fetched: string[] = [];
  const fetchImpl: any = async (url: string) => { fetched.push(url); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ via: 'server' }), text: async () => '' }; };
  const { local } = setup();
  let useLocal = true;
  const api = new RoutedApi(() => 'https://example.test', { get: async () => undefined, set: async () => undefined }, () => 1000, local, () => useLocal, fetchImpl);
  const job = await api.submit('x = 1', 'python', undefined, undefined);
  await api.waitForResult(job.id, () => false);
  await api.request('GET', `/verifications/${job.id}/explanation`);
  await api.request('GET', '/verifications?limit=5');
  await api.request('GET', '/profile');
  await api.request('POST', '/feedback', { rating: 'helpful' });
  assert.deepEqual(fetched, [], 'no request left the machine');
  assert.equal((await api.request('GET', '/me/entitlements')).via, 'server', 'account paths still go to the server');
  assert.equal((await api.request('GET', '/health', undefined, { auth: false })).via, 'server');
  useLocal = false;
  fetched = [];
  await api.request('GET', '/verifications?limit=5');
  assert.equal(fetched.length, 1, 'server selection uses the server');
  assert.ok(LocalAnalysis.handles('/session-verifications') && !LocalAnalysis.handles('/me/data') && !LocalAnalysis.handles('/experiments/next') && !LocalAnalysis.handles('/auth/login'));
});

test('engine helpers: version gate, platform paths, answer parsing', () => {
  assert.deepEqual(parsePythonVersion('3.12\n'), [3, 12]);
  assert.equal(parsePythonVersion('Python 3.12.1'), undefined);
  assert.ok(pythonOk([3, 11]) && pythonOk([3, 14]) && pythonOk([4, 0]));
  assert.ok(!pythonOk([3, 10]) && !pythonOk([2, 7]) && !pythonOk(undefined));
  assert.match(venvPaths('/x/venv', 'darwin').python, /\/x\/venv\/bin\/python$/);
  assert.match(venvPaths('C:\\x\\venv', 'win32').scanner, /Scripts.trustcode-scan\.exe$/);
  assert.deepEqual(parseAnswer('noise\n{"ok":true,"protocol":1}\n'), { ok: true, protocol: 1 });
  assert.equal(parseAnswer('{"result": 1}\n'), undefined, 'an object without ok is not an answer');
  assert.equal(parseAnswer('Traceback...\n'), undefined);
  assert.equal(parseAnswer(''), undefined);
});

test('ui: the engine notice states that nothing is checked until setup, and privacy rows follow the selection', () => {
  assert.equal(engineNotice({ status: 'ready' }), '');
  assert.match(engineNotice({ status: 'missing' }), /nothing is checked/i);
  assert.match(engineNotice({ status: 'missing' }), /data-action="engineSetup"/);
  assert.match(engineNotice({ status: 'failed', detail: '<b>no python</b>' }), /&lt;b&gt;no python/);
  assert.match(engineNotice({ status: 'installing' }), /Setting up/);
  const base = { scanner: 'ready' as const, signedIn: false, backend: 'https://s.example', localBackend: false, llmSetting: true, llmAllowedInProfile: true, llmAvailableOnServer: true,
    onlineAdvisories: false, updateCheck: true };
  const localRows = privacyStatus({ ...base, engine: { status: 'ready', version: 'trustcode-worker 0.2.0' }, localHistory: { runs: 3, feedback: 1 }, registryLookups: false });
  const row = (rows: any[], label: string) => rows.find((r) => r.label === label);
  assert.equal(row(localRows, 'Code sent to the TrustCode server').value, 'Never');
  assert.match(row(localRows, 'Verify and Session analysis').value, /On this computer/);
  assert.equal(row(localRows, 'External AI analysis').on, false);
  assert.equal(row(localRows, 'Package registry lookups').value, 'Off');
  assert.match(row(privacyStatus({ ...base, engine: { status: 'missing' } }), 'Verify and Session analysis').value, /Not available/);
  assert.match(row(privacyStatus({ ...base, engine: { status: 'ready' }, registryLookups: true }), 'Package registry lookups').value, /sent to PyPI/);
  const serverRows = privacyStatus({ ...base, signedIn: true });
  assert.match(row(serverRows, 'Code sent to the TrustCode server').value, /after you confirm/);
  assert.equal(row(serverRows, 'Verify and Session analysis'), undefined);
  assert.match(verifyForm(undefined, '', true), /not uploaded/);
  assert.match(verifyForm(undefined, '', false), /Nothing is sent until you confirm/);
  assert.match(account({ backend: 'https://s.example', mode: 'account', signedIn: false, profile: { experience_level: 'beginner' }, local: true }), /On this computer[\s\S]*optional/);
  assert.doesNotMatch(account({ backend: 'b', mode: 'account', signedIn: false, profile: {}, local: true }), /allow_llm/);
});
