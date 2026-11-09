import * as assert from 'node:assert';
import { test } from 'node:test';
import { ApiError, describeError, TrustCodeApi } from '../src/api';
import { consentMessage, isLoopback, normaliseBackend } from '../src/consent';
import { renderChecks, renderFindings, renderResult, renderUnverified, statusChip } from '../src/render';

const store = (t?: any) => { let v = t; return { get: async () => v, set: async (x: any) => { v = x; }, peek: () => v }; };
const res = (status: number, body: any, headers: Record<string, string> = {}, json = true) => ({
  ok: status < 400, status, headers: { get: (n: string) => ({ 'content-type': json ? 'application/json' : 'text/html', ...headers } as any)[n.toLowerCase()] ?? null },
  json: async () => { if (!json) throw new SyntaxError('Unexpected token <'); return body; }, text: async () => String(body),
});

test('non-JSON error body (e.g. proxy HTML page) yields a clean HTTP error', async () => {
  const api = new TrustCodeApi(() => 'http://h', store({ access: 'a' }), () => 1000, async () => res(502, '<html>Bad gateway</html>', {}, false));
  await assert.rejects(api.request('GET', '/x'), (e: any) => e instanceof ApiError && e.status === 502 && e.message === 'HTTP 502');
});

test('validation error arrays are joined into readable text', async () => {
  const body = { error: { code: 'validation_error', message: [{ loc: ['body', 'code'], msg: 'too long' }, { loc: ['x'], msg: 'bad' }] } };
  const api = new TrustCodeApi(() => 'http://h', store({ access: 'a' }), () => 1000, async () => res(422, body));
  await assert.rejects(api.request('POST', '/x', {}), (e: any) => e.message === 'too long; bad');
});

test('network failure and timeout are reported as status 0', async () => {
  const down = new TrustCodeApi(() => 'http://h', store(), () => 1000, async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(down.request('GET', '/x', undefined, { auth: false }), (e: any) => e.status === 0 && /fetch failed/.test(e.message));
  const slow = new TrustCodeApi(() => 'http://h', store(), () => 20, (_u: string, init: any) => new Promise((_r, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await assert.rejects(slow.request('GET', '/x', undefined, { auth: false }), (e: any) => e.status === 0 && e.message === 'request timed out');
});

test('failed token refresh clears stored tokens (forces re-login) and surfaces 401', async () => {
  const s = store({ access: 'old', refresh: 'r' });
  const calls: any[] = [];
  const fetchImpl = async (url: string) => { calls.push(url); return res(401, { error: { code: 'unauthorized', message: 'expired' } }); };
  const api = new TrustCodeApi(() => 'http://h', s, () => 1000, fetchImpl);
  await assert.rejects(api.request('GET', '/profile'), (e: any) => e.status === 401);
  assert.strictEqual(s.peek(), undefined);
  assert.strictEqual(calls.length, 2, 'exactly one refresh attempt, no retry loop');
});

test('no Authorization header is sent when there is no token, or for auth:false requests', async () => {
  const seen: any[] = [];
  const api = new TrustCodeApi(() => 'http://h/', store(), () => 1000, async (u: string, init: any) => { seen.push({ u, h: init.headers }); return res(200, {}); });
  await api.request('GET', '/health', undefined, { auth: false });
  assert.strictEqual(seen[0].h.Authorization, undefined);
  assert.strictEqual(seen[0].u, 'http://h/api/v1/health', 'trailing slash normalised');
});

test('describeError covers all branches', () => {
  assert.match(describeError(new ApiError(401, 'x', 'y')), /sign in again/);
  assert.match(describeError(new ApiError(500, 'x', 'y', 'rid1')), /request rid1/);
  assert.strictEqual(describeError(new ApiError(409, 'conflict', 'already decided')), 'already decided');
  assert.strictEqual(describeError(new Error('plain')), 'plain');
  assert.strictEqual(describeError('str'), 'str');
});

test('waitForResult gives up with a clear error instead of polling forever', async () => {
  const api = new TrustCodeApi(() => 'http://h', store({ access: 'a' }), () => 1000, async () => res(200, { status: 'running' }));
  await assert.rejects(api.waitForResult('j', () => false, undefined, 1, 30), (e: any) => /too long/.test(e.message));
});

test('renderers tolerate null, undefined and empty data', () => {
  assert.doesNotThrow(() => renderResult({}));
  assert.doesNotThrow(() => renderChecks({ checks: null }));
  assert.match(renderFindings({ findings: [] }), /does <strong>not<\/strong> mean/);
  assert.match(renderUnverified({}), /Not verified \(0\)/);
  assert.match(statusChip('weird-status'), /weird-status/);
  const html = renderResult({ findings: [{ finding_id: null, severity: undefined, what: undefined }] });
  assert.ok(!/undefined/i.test(html), 'raw undefined leaked into the UI');
});

test('LLM assumptions are escaped and labelled as needing review', () => {
  const html = renderUnverified({ unverified: [], llm: { assumptions: [{ statement: '<script>x</script>', line: 3 }] } });
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /Requires human review — suggested by AI/);
});

test('consent helpers handle invalid and unusual URLs', () => {
  assert.strictEqual(normaliseBackend('not a url'), 'not a url');
  assert.strictEqual(normaliseBackend('HTTPS://Example.COM:443/path'), 'https://example.com');
  assert.ok(!isLoopback('not a url'));
  assert.ok(isLoopback('http://[::1]:8000'));
  assert.match(consentMessage(0, 0, 'https://x.example', false, false), /Send 0 selected line/);
});
