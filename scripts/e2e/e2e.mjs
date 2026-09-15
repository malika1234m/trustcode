// End-to-end test: VS Code extension API client -> HTTP API -> DB queue -> worker process -> Docker sandbox.
// Usage: node scripts/e2e/e2e.mjs <backendUrl> <localSecretFile>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { TrustCodeApi, ApiError } = require('../../extension/out/src/api.js');

const [base, secretFile] = process.argv.slice(2);
let tokens;
const store = { get: async () => tokens, set: async (t) => { tokens = t; } };
const api = new TrustCodeApi(() => base, store, () => 30000);
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e) }); console.log(`FAIL ${name}: ${e?.message ?? e}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const run = async (code, language, tests, task) => {
  const j = await api.submit(code, language, task, tests);
  return api.waitForResult(j.id, () => false, undefined, 500, 120000);
};
const check = (r, kind) => r.result.checks.find((c) => c.kind === kind);

await step('auth: local-mode login with per-install secret', async () => {
  await api.localLogin(fs.readFileSync(secretFile, 'utf8').trim());
  assert(tokens?.access, 'no token');
});
await step('auth: wrong local secret rejected', async () => {
  const bad = new TrustCodeApi(() => base, { get: async () => undefined, set: async () => {} }, () => 5000);
  try { await bad.localLogin('wrong'); throw new Error('accepted wrong secret'); } catch (e) { assert(e instanceof ApiError && e.status === 401, 'expected 401'); }
});
let jobA;
await step('A: correct code -> checks run, no unsupported correctness claim', async () => {
  const r = await run('def add(a, b):\n    return a + b\n', 'python', 'from solution import add\ndef test_add():\n    assert add(2, 3) == 5\n', 'add two numbers');
  jobA = r.id;
  assert(r.status === 'done', r.status);
  assert(check(r, 'tests').status === 'passed' && check(r, 'requirements').status === 'needs_review', 'statuses');
  assert(!/"(score|verdict)"/.test(JSON.stringify(r.result)), 'aggregate verdict present');
});
await step('B: vulnerable code -> security finding with evidence + explanation', async () => {
  const r = await run("import os\ndef backup(name):\n    os.system('tar czf /tmp/b.tgz ' + name)\n", 'python');
  const sec = check(r, 'security');
  assert(sec.status === 'issues_found' && sec.findings[0].cwe.includes('CWE-78'), 'no CWE-78');
  const ex = await api.request('GET', `/verifications/${r.id}/explanation?level=beginner`);
  assert(ex.findings[0].evidence === sec.findings[0].message, 'evidence altered');
});
await step('C: logical defect -> failing test shown; uncovered code marked unverified', async () => {
  const code = 'def is_even(n):\n    return n % 2 == 1\n\ndef helper(x):\n    return x\n';
  const r = await run(code, 'python', 'from solution import is_even\ndef test_two():\n    assert is_even(2)\n');
  assert(check(r, 'tests').details.failed === 1, 'no failing test');
  assert(r.result.unverified.some((u) => u.description.includes('helper')), 'helper not marked unverified');
});
await step('D: incomplete/invalid code -> syntax error, no pretend success', async () => {
  const r = await run('function f( {\n  return 1\n', 'javascript', "const t=require('node:test');t('x',()=>{});");
  assert(check(r, 'syntax').status === 'issues_found', 'syntax');
  assert(['not_run'].includes(check(r, 'tests').status) && check(r, 'security').status === 'not_run', 'dependent checks should not run');
});
await step('E: adaptive explanations -> depth changes, evidence identical', async () => {
  const r = await run("import pickle\ndef load(b):\n    return pickle.loads(b)\n", 'python');
  const v = {};
  for (const l of ['beginner', 'intermediate', 'advanced']) v[l] = await api.request('GET', `/verifications/${r.id}/explanation?level=${l}`);
  const ev = (x) => JSON.stringify(x.findings.map((f) => [f.finding_id, f.evidence, f.severity]));
  assert(ev(v.beginner) === ev(v.intermediate) && ev(v.intermediate) === ev(v.advanced), 'evidence differs');
  assert(v.beginner.findings[0].why !== v.advanced.findings[0].why, 'wording did not adapt');
});
await step('F: human decision recorded; code not modified by TrustCode', async () => {
  const d = await api.request('POST', `/verifications/${jobA}/decision`, { decision: 'modify', confidence: 60 });
  assert(d.recorded && /never modifies/.test(d.note), 'decision');
});
await step('G1: malicious code (network + fork bomb) contained, never "passed"', async () => {
  const r = await run("import os, socket\ndef f():\n    socket.create_connection(('8.8.8.8', 53), timeout=2)\n    while True:\n        os.fork()\n", 'python',
    'from solution import f\ndef test_f():\n    f()\n');
  assert(check(r, 'tests').status !== 'passed', 'malicious code passed');
});
await step('G2: infinite loop -> timeout reported', async () => {
  const r = await run('def f():\n    while True:\n        pass\n', 'python', 'from solution import f\ndef test_f():\n    f()\n');
  assert(['issues_found', 'check_failed'].includes(check(r, 'tests').status), check(r, 'tests').status);
});
await step('G3: malformed input rejected with structured error', async () => {
  try { await api.request('POST', '/verifications', { code: '', client_consent: true }); throw new Error('accepted'); }
  catch (e) { assert(e instanceof ApiError && e.status === 422 && e.code === 'validation_error', `got ${e.status}`); }
});
await step('G4: invalid authentication rejected', async () => {
  const anon = new TrustCodeApi(() => base, { get: async () => ({ access: 'forged.token.value' }), set: async () => {} }, () => 5000);
  try { await anon.request('GET', '/profile'); throw new Error('accepted'); } catch (e) { assert(e.status === 401, `got ${e.status}`); }
});
await step('G5: cancellation of a queued/running job', async () => {
  const j = await api.submit('def f():\n    return 1\n', 'python', undefined, 'from solution import f\ndef test_f():\n    assert f() == 1\n');
  const r = await api.waitForResult(j.id, () => true);
  assert(r.status === 'cancelled', r.status);
});
await step('G6: API unavailable -> clear network error', async () => {
  const down = new TrustCodeApi(() => 'http://127.0.0.1:9', store, () => 3000);
  try { await down.request('GET', '/health', undefined, { auth: false }); throw new Error('no error'); } catch (e) { assert(e.status === 0, `got ${e.status}`); }
});
await step('G7: LLM provider unavailable -> template fallback', async () => {
  await api.request('PATCH', '/profile', { allow_llm: true });
  const ex = await api.request('GET', `/verifications/${jobA}/explanation?llm=true`);
  assert(ex.llm.used === false, 'LLM unexpectedly used');
  await api.request('PATCH', '/profile', { allow_llm: false });
});
fs.writeFileSync(process.env.E2E_OUT ?? 'e2e-results.json', JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} end-to-end steps passed`);
process.exit(failed ? 1 : 0);
