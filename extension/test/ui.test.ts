import * as assert from 'node:assert';
import { test } from 'node:test';
import { account, history, page, progress, summaryTiles, verifyForm, welcome } from '../src/ui';

const XSS = '<img src=x onerror=alert(1)>';

test('page shows header, three tabs and marks the active one', () => {
  const html = page('history', true, 'trustcode-api.vercel.app', '<p>x</p>');
  assert.strictEqual((html.match(/role="tab"/g) ?? []).length, 3);
  assert.match(html, /class="tab active" aria-selected="true" data-action="tab" data-tab="history">History/);
  assert.match(html, /● trustcode-api\.vercel\.app/);
});

test('welcome offers sign in, create account and local mode, and escapes the server URL', () => {
  const html = welcome(`https://x.example/${XSS}`);
  for (const a of ['signIn', 'createAccount', 'useLocal']) assert.match(html, new RegExp(`data-action="${a}"`));
  assert.ok(!html.includes('<img src=x'));
});

test('verify form: selection box and escaped task', () => {
  assert.match(verifyForm(undefined), /Get started/);
  assert.match(verifyForm(undefined), /<ol class="steps-onboard">/);
  const html = verifyForm({ lines: 4, language: 'python', file: XSS }, XSS);
  assert.match(html, /4 line\(s\) selected/);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /data-action="verify"/);
});

test('summary tiles are computed from evidence, with no verdict', () => {
  const html = summaryTiles({
    checks: [{ status: 'passed' }, { status: 'passed' }, { status: 'issues_found' }, { status: 'not_run' }, { status: 'check_failed' }],
    findings: [{}, {}, {}], unverified: [{}], llm: { assumptions: [{}] },
  });
  const nums = [...html.matchAll(/<div class="num">(\d+)<\/div><div class="lbl">([^<]+)</g)].map((m) => `${m[2]}=${m[1]}`);
  assert.deepStrictEqual(nums, ['Findings=3', 'Not verified=2', 'No findings=2', 'Not run / failed=2']);
  assert.ok(!/\b(safe|secure|score)\b/i.test(html));
  assert.doesNotThrow(() => summaryTiles(undefined));
});

test('history: empty state, escaped rows, only finished jobs are clickable', () => {
  assert.match(history([]), /No verifications yet/);
  const html = history([
    { id: 'a'.repeat(32), status: 'done', language: 'python', code_lines: 3, created_at: '2026-11-09T10:00:00Z' },
    { id: 'b'.repeat(32), status: 'expired', language: XSS, code_lines: 1, created_at: '2026-11-08T10:00:00Z' },
  ]);
  assert.match(html, new RegExp(`data-job="${'a'.repeat(32)}" >`));
  assert.match(html, new RegExp(`data-job="${'b'.repeat(32)}" disabled`));
  assert.ok(!html.includes('<img'));
});

test('account: signed-out shows sign in only; signed-in shows level, privacy toggles and danger zone', () => {
  const out = account({ backend: 'https://x', mode: 'account', signedIn: false });
  assert.match(out, /data-action="signIn"/);
  assert.ok(!out.includes('Danger zone'));
  const inn = account({ backend: 'https://x', mode: 'account', signedIn: true,
    profile: { experience_level: 'advanced', store_history: true, allow_llm: false, adaptive_suggestions: false } });
  assert.match(inn, /aria-pressed="true" class="on">Advanced/);
  assert.match(inn, /data-key="store_history" checked/);
  assert.match(inn, /data-key="allow_llm" >/);
  assert.match(inn, /Danger zone/);
});

test('progress card is busy-announced and escapes status', () => {
  const html = progress(XSS);
  assert.match(html, /aria-busy="true"/);
  assert.ok(!html.includes('<img'));
});

test('error card offers retry and settings and escapes the message', async () => {
  const { errorCard } = await import('../src/ui');
  const html = errorCard(XSS);
  assert.match(html, /data-action="refresh">Retry/);
  assert.match(html, /data-action="openSettings"/);
  assert.ok(!html.includes('<img'));
});
