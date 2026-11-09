// Browser sign-in helpers (OAuth 2.0 authorization code + PKCE, RFC 7636). No vscode import -> unit-testable.
import { createHash, randomBytes } from 'crypto';

export const EXTENSION_ID = 'trustcode-research.trustcode';
export const CALLBACK_PATH = '/auth-callback';
export const PENDING_TTL_MS = 10 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface Pkce { verifier: string; challenge: string; state: string }

export function newPkce(): Pkce {
  const verifier = b64url(randomBytes(48));           // 64 chars, within RFC 7636 limits (43-128)
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(randomBytes(24)) };
}

export function callbackUri(uriScheme: string): string {
  return `${uriScheme}://${EXTENSION_ID}${CALLBACK_PATH}`;
}

export function authorizeUrl(backend: string, redirectUri: string, p: Pkce, mode: 'login' | 'register' = 'login'): string {
  const u = new URL('/auth/extension', backend.replace(/\/$/, '') + '/');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('mode', mode);
  return u.toString();
}

export interface Pending { verifier: string; redirectUri: string; backend: string; createdAt: number }

/** Validates an incoming editor URI against the pending sign-in it must belong to. */
export function parseCallback(path: string, query: string, pending: Map<string, Pending>, nowMs = Date.now()):
  { ok: true; code: string; pending: Pending } | { ok: false; reason: string } {
  if (path !== CALLBACK_PATH) return { ok: false, reason: 'unknown link' };
  const q = new URLSearchParams(query);
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const p = pending.get(state);
  if (!p) return { ok: false, reason: 'This sign-in link was not started from this window (or was already used).' };
  pending.delete(state);  // single use, success or not
  if (nowMs - p.createdAt > PENDING_TTL_MS) return { ok: false, reason: 'The sign-in took too long. Please try again.' };
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(code)) return { ok: false, reason: 'The sign-in response was malformed.' };
  return { ok: true, code, pending: p };
}
