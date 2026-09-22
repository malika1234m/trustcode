import * as assert from 'node:assert';
import { test } from 'node:test';
import { ApiError, describeError, TrustCodeApi } from '../src/api';
import { consentMessage, isLoopback, languageFor, needsPrompt, remember } from '../src/consent';
import { esc, renderFinding, renderResult, statusChip } from '../src/render';

const view = {
  level: 'beginner', adaptation: { suggestion: null },
  checks: [{ kind: 'tests', status: 'not_run', status_text: 'Not tested', summary: 'No tests supplied.', scope: 'Not run.', tool: 'pytest' }],
  findings: [{ finding_id: 'SEC-1', severity: 'high', what: '<img src=x onerror=alert(1)>', where: 'line 3', method: 'Semgrep',
               why: 'w', evidence: '<script>alert(1)</script>', could_not_verify: 'c', next_step: 'n', source: 'template' }],
  unverified: [{ id: 'U-1', description: 'Runtime behaviour', explanation: 'No tests' }],
  guidance: ['g'], disclaimer: 'Passing checks do not establish correctness.', llm: { used: false },
};

test('esc neutralises HTML', () => {
  assert.strictEqual(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('rendered result never contains raw markup from data', () => {
  const html = renderResult(view);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('status chips always carry text, not just colour', () => {
  for (const s of ['passed', 'issues_found', 'check_failed', 'not_run', 'needs_review']) {
    const chip = statusChip(s);
    assert.match(chip, /class="chip st-/);
    assert.match(chip.replace(/<[^>]+>/g, ''), /[A-Za-z]/);
  }
  assert.match(statusChip('not_run'), /Not tested/);
});

test('no safe/green verdict is rendered', () => {
  const html = renderResult({ ...view, findings: [], checks: [{ ...view.checks[0], status: 'passed' }] });
  const claims = html.replace(/does <strong>not<\/strong> mean[^<]*/g, '').replace(/There is no overall “safe” score\./g, '');
  assert.ok(!/\b(safe|secure|verified correct)\b/i.test(claims));
  assert.match(html, /does <strong>not<\/strong> mean the code is free of defects/);
});

test('finding shows the seven explanation fields', () => {
  const html = renderFinding(view.findings[0], true);
  for (const label of ['Where', 'Detected by', 'Why it matters', 'Evidence', 'Not verified', 'Suggested next step']) assert.ok(html.includes(label), label);
});

test('consent prompt required until remembered, per backend', () => {
  let s = { trustedBackends: [] as string[] };
  assert.ok(needsPrompt(s, 'http://127.0.0.1:8000'));
  s = remember(s, 'http://127.0.0.1:8000/');
  assert.ok(!needsPrompt(s, 'http://127.0.0.1:8000'));
  assert.ok(needsPrompt(s, 'https://trustcode.example.org'));
});

test('consent message distinguishes local vs remote and mentions LLM', () => {
  assert.match(consentMessage(3, 40, 'http://127.0.0.1:8000', false, false), /local TrustCode backend/);
  assert.match(consentMessage(3, 40, 'https://x.example', true, true), /your tests to the remote TrustCode server.*LLM explanations are ON/s);
  assert.ok(isLoopback('http://localhost:1') && !isLoopback('https://evil.example'));
});

test('language mapping', () => {
  assert.strictEqual(languageFor('python'), 'python');
  assert.strictEqual(languageFor('javascriptreact'), 'javascript');
  assert.strictEqual(languageFor('rust'), undefined);
});

function fakeFetch(responses: Array<{ status: number; body: any; headers?: Record<string, string> }>, calls: any[] = []) {
  return async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    const h = { 'content-type': 'application/json', ...(r.headers ?? {}) };
    return { ok: r.status < 400, status: r.status, headers: { get: (n: string) => h[n.toLowerCase() as keyof typeof h] ?? null },
             json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
}

function memStore(initial?: any) {
  let t = initial;
  return { get: async () => t, set: async (v: any) => { t = v; }, peek: () => t };
}

test('api maps structured errors and retry-after', async () => {
  const api = new TrustCodeApi(() => 'http://h', memStore({ access: 'a' }), () => 1000,
    fakeFetch([{ status: 429, body: { error: { code: 'rate_limited', message: 'rate limit exceeded', request_id: 'r1' } }, headers: { 'retry-after': '7' } }]));
  await assert.rejects(api.request('GET', '/profile'), (e: any) => e instanceof ApiError && e.status === 429 && e.retryAfter === 7);
  assert.match(describeError(new ApiError(429, 'rate_limited', 'x', undefined, 7)), /7s/);
  assert.match(describeError(new ApiError(0, 'network', 'ECONNREFUSED')), /Cannot reach/);
});

test('api refreshes once on 401 and retries', async () => {
  const store = memStore({ access: 'old', refresh: 'r' });
  const calls: any[] = [];
  const api = new TrustCodeApi(() => 'http://h', store, () => 1000, fakeFetch([
    { status: 401, body: { error: { code: 'unauthorized', message: 'expired' } } },
    { status: 200, body: { access_token: 'new', refresh_token: 'r2' } },
    { status: 200, body: { ok: true } },
  ], calls));
  assert.deepStrictEqual(await api.request('GET', '/profile'), { ok: true });
  assert.strictEqual(store.peek().access, 'new');
  assert.strictEqual(calls[2].init.headers.Authorization, 'Bearer new');
});

test('submission always declares consent and never sends empty optional fields', async () => {
  const calls: any[] = [];
  const api = new TrustCodeApi(() => 'http://h', memStore({ access: 'a' }), () => 1000, fakeFetch([{ status: 202, body: { id: 'j1' } }], calls));
  await api.submit('x = 1', 'python', '', undefined);
  const body = JSON.parse(calls[0].init.body);
  assert.strictEqual(body.client_consent, true);
  assert.ok(!('task' in body) && !('tests' in body));
});

test('cancellation stops polling and cancels the job', async () => {
  const calls: any[] = [];
  const api = new TrustCodeApi(() => 'http://h', memStore({ access: 'a' }), () => 1000, fakeFetch([{ status: 200, body: { status: 'cancelled' } }], calls));
  const r = await api.waitForResult('j1', () => true);
  assert.strictEqual(r.status, 'cancelled');
  assert.match(calls[0].url, /\/verifications\/j1\/cancel$/);
});

test('security-sensitive settings cannot be overridden by workspace settings', () => {
  const pkg = require('../../package.json');
  const props = pkg.contributes.configuration.properties;
  for (const k of ['trustcode.backendUrl', 'trustcode.mode', 'trustcode.useLlmExplanations']) assert.strictEqual(props[k].scope, 'application', k);
});
