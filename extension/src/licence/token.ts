// Licence token verification (pure: no vscode import -> unit-testable). Format: "tcl1.<b64url JSON>.<b64url sig>";
// the Ed25519 signature covers "tcl1.<b64url JSON>". Verified on every load; nothing in a licence is trusted
// before its signature is checked against a pinned key.
import { createPublicKey, verify } from 'crypto';

export interface LicencePayload {
  v: number; kid: string; lid: string; sub: string; dev: string;
  plan: { id: string; name: string }; state: string;
  features: Record<string, unknown>; limits: Record<string, unknown>;
  act: number; iat: number; validated_at: number; grace_days: number;
  offline_until: number; paid_until: number | null; refresh_after: number;
  /** The account's revocation version when this licence was issued (servers from 1.2.0). */
  rev?: number;
  /** Seconds between status checks while online (servers from 1.2.0). */
  check_after?: number;
}

export type VerifyResult = { ok: true; payload: LicencePayload } | { ok: false; reason: 'malformed' | 'unknown_key' | 'bad_signature' | 'unsupported' };

const B64U = /^[A-Za-z0-9_-]+$/;
export const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const keyCache = new Map<string, ReturnType<typeof createPublicKey>>();
function publicKey(x: string) {
  let k = keyCache.get(x);
  if (!k) { k = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }); keyCache.set(x, k); }
  return k;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function wellFormed(p: any): p is LicencePayload {
  return p && p.v === 1 && typeof p.kid === 'string' && typeof p.lid === 'string' && typeof p.sub === 'string' && typeof p.dev === 'string'
    && p.plan && typeof p.plan.id === 'string' && typeof p.plan.name === 'string' && typeof p.state === 'string'
    && p.features && typeof p.features === 'object' && p.limits && typeof p.limits === 'object'
    && isInt(p.iat) && isInt(p.validated_at) && isInt(p.offline_until) && isInt(p.refresh_after) && isInt(p.grace_days)
    && (p.paid_until === null || isInt(p.paid_until)) && p.offline_until > p.iat;
}

export function verifyLicence(token: unknown, keys: Readonly<Record<string, string>>): VerifyResult {
  if (typeof token !== 'string' || token.length > 8192) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'tcl1' || !B64U.test(parts[1]) || !B64U.test(parts[2])) return { ok: false, reason: 'malformed' };
  let claimed: any;
  try { claimed = JSON.parse(fromB64u(parts[1]).toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  const x = typeof claimed?.kid === 'string' && Object.prototype.hasOwnProperty.call(keys, claimed.kid) ? keys[claimed.kid] : undefined;
  if (!x) return { ok: false, reason: 'unknown_key' };
  let good = false;
  try { good = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey(x), fromB64u(parts[2])); } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };
  return wellFormed(claimed) ? { ok: true, payload: claimed } : { ok: false, reason: 'unsupported' };
}
