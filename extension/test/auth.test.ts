import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { authorizeUrl, callbackUri, newPkce, parseCallback, Pending, PENDING_TTL_MS } from '../src/auth';

test('PKCE pair follows RFC 7636 (S256, base64url, 43-128 chars)', () => {
  const p = newPkce();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const expected = createHash('sha256').update(p.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(p.challenge, expected);
  assert.notStrictEqual(newPkce().state, p.state, 'state must be random');
});

test('authorize URL carries redirect, state, challenge and mode, never the verifier', () => {
  const p = newPkce();
  const u = new URL(authorizeUrl('https://trustcode-api.vercel.app/', callbackUri('vscode'), p, 'register'));
  assert.strictEqual(u.origin + u.pathname, 'https://trustcode-api.vercel.app/auth/extension');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'vscode://trustcode-research.trustcode/auth-callback');
  assert.strictEqual(u.searchParams.get('code_challenge'), p.challenge);
  assert.strictEqual(u.searchParams.get('mode'), 'register');
  assert.ok(!u.toString().includes(p.verifier));
});

test('callback validation: correct state succeeds once; forged, reused and stale links fail', () => {
  const pending = new Map<string, Pending>();
  const code = 'c'.repeat(43);
  pending.set('s1'.repeat(12), { verifier: 'v', redirectUri: 'r', backend: 'b', createdAt: Date.now() });
  assert.deepStrictEqual(parseCallback('/auth-callback', `code=${code}&state=${'s1'.repeat(12)}`, pending).ok, true);
  assert.strictEqual(parseCallback('/auth-callback', `code=${code}&state=${'s1'.repeat(12)}`, pending).ok, false, 'reuse');
  assert.strictEqual(parseCallback('/auth-callback', `code=${code}&state=forged-state-value-123`, pending).ok, false, 'forged');
  pending.set('old'.repeat(8), { verifier: 'v', redirectUri: 'r', backend: 'b', createdAt: Date.now() - PENDING_TTL_MS - 1 });
  assert.strictEqual(parseCallback('/auth-callback', `code=${code}&state=${'old'.repeat(8)}`, pending).ok, false, 'stale');
  pending.set('s2'.repeat(12), { verifier: 'v', redirectUri: 'r', backend: 'b', createdAt: Date.now() });
  assert.strictEqual(parseCallback('/auth-callback', `code=<script>&state=${'s2'.repeat(12)}`, pending).ok, false, 'malformed code');
  assert.strictEqual(parseCallback('/other', 'code=x&state=y', pending).ok, false, 'unknown path');
});
