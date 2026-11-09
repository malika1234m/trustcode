import * as assert from 'node:assert';
import { test } from 'node:test';
import { renderDecision, renderFinding, renderHeadline } from '../src/render';

const VERDICT = /\b(safe|secure|correct code|verified correct|no bugs)\b/i;

test('headline describes evidence counts, never a verdict', () => {
  const a = renderHeadline({ findings: [{}, {}], unverified: [{}], checks: [{ status: 'check_failed' }] });
  assert.match(a, /2 findings need your attention/);
  assert.match(a, /1 area not verified · 1 check could not run/);
  const b = renderHeadline({ findings: [], unverified: [], checks: [] });
  assert.match(b, /The checks reported no findings/);
  assert.match(b, /not proof of correctness/);
  for (const h of [a, b]) assert.ok(!VERDICT.test(h.replace(/not proof of correctness/, '')), h);
  assert.match(renderHeadline({ findings: [{}] }), /1 finding needs your attention/);
});

test('decision card: open state has three actions and a confidence slider; decided state confirms in place', () => {
  const open = renderDecision('decide');
  assert.strictEqual((open.match(/data-action="decide"/g) ?? []).length, 3);
  assert.match(open, /type="range"/);
  const done = renderDecision('decide', { decision: 'reject', confidence: 70 });
  assert.match(done, /Rejected/);
  assert.match(done, /70% confident · recorded/);
  assert.match(done, /data-action="changeDecision"/);
  assert.ok(!/data-action="decide"/.test(done));
});

test('finding shows essentials first, evidence folded, go-to-line only when a line exists', () => {
  const f = { finding_id: 'SEC-1', severity: 'high', what: 'SQL injection risk', where: 'In the submitted code, line 3', method: 'Semgrep',
    why: 'w', evidence: 'raw tool text', could_not_verify: 'c', next_step: 'n' };
  const html = renderFinding(f, true);
  assert.ok(html.indexOf('Why it matters') < html.indexOf('Evidence (tool output)'), 'evidence should come after essentials');
  assert.match(html, /<details class="f-more"[^>]*><summary>Evidence &amp; limits<\/summary>/);
  assert.match(html, /data-action="reveal" data-finding="SEC-1">Go to line/);
  assert.ok(!renderFinding({ ...f, where: 'Whole snippet' }, true).includes('data-action="reveal"'));
  assert.ok(!renderFinding(f, false).includes('data-action="feedback"'));
});
