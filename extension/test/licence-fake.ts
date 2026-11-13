// Shared test double for the licence tests: a fake TrustCode server that signs real Ed25519 licences, an in-memory
// SecretStorage, an injected clock and a timer wheel. Not a test file itself (its name does not end in .test).
import { createPublicKey, generateKeyPairSync, sign, verify } from 'crypto';
import { ApiError } from '../src/api';
import { LicenceManager } from '../src/licence/manager';
import { fromB64u } from '../src/licence/token';

export const DAY = 86400_000;
export const HOUR = 3600_000;
export const MINUTE = 60_000;
export const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const server = generateKeyPairSync('ed25519');
export const KEYS = { t1: (server.publicKey.export({ format: 'jwk' }) as any).x as string };

export function signToken(p: object, key = server.privateKey) {
  const body = b64u(Buffer.from(JSON.stringify(p)));
  return `tcl1.${body}.${b64u(sign(null, Buffer.from(`tcl1.${body}`), key))}`;
}

type Fault = 'html' | 'drop' | 'hang' | undefined;

/** A fake TrustCode server: account state, device registry, revocation version, and switches for every fault. */
export class FakeServer {
  clock = Date.UTC(2026, 10, 13);
  plan = { id: 'pro', name: 'Pro' };
  paidUntil: number | null = this.clock + 60 * DAY;
  grace = 30;
  /** Unreachable: the request fails before any answer (DNS failure, no route). */
  reachable = true;
  /** Answer every device request with this HTTP status (500, 503, 429). */
  failWith?: number;
  /** html: a captive portal answers 200 with a web page; drop: the connection ends while the body is read;
   *  hang: no answer at all until the caller gives up. */
  fault: Fault;
  /** The server refuses the device with this code (device_revoked, device_deactivated, account_suspended). */
  refusal?: string;
  /** A server from before 1.2.0: no status endpoint, no revocation version. */
  legacy = false;
  rev = 0;
  checkAfter = 3600;
  kid = 't1';
  key = server.privateKey;
  devices = new Map<string, { publicKey: string; counter: number; lid?: string }>();
  maxDevices = 3;
  calls: string[] = [];
  bodies: { path: string; data: any }[] = [];
  private n = 0;

  issue(dev: string) {
    const iat = Math.floor(this.clock / 1000);
    const lid = 'l' + (++this.n);
    const d = this.devices.get(dev);
    if (d) d.lid = lid;
    const p: any = { v: 1, kid: this.kid, lid, sub: 'a'.repeat(32), dev, plan: this.plan, state: 'active',
      features: { llm_explanations: this.plan.id !== 'free' }, limits: {}, act: iat, iat, validated_at: iat, grace_days: this.grace,
      offline_until: iat + this.grace * 86400, paid_until: this.plan.id === 'free' ? null : this.paidUntil && Math.floor(this.paidUntil / 1000), refresh_after: iat + 86400 };
    if (!this.legacy) { p.rev = this.rev; p.check_after = this.checkAfter; }
    return { licence: signToken(p, this.key), server_time: iat };
  }

  /** Account-authenticated calls (activation). */
  authed = async (_m: string, path: string, body: any) => {
    this.calls.push(path);
    this.bodies.push({ path, data: body });
    if (!this.reachable) throw new ApiError(0, 'network', 'offline');
    if (this.devices.size >= this.maxDevices && !this.devices.has(body.device_id)) throw new ApiError(409, 'device_limit_reached', 'limit');
    this.devices.set(body.device_id, { publicKey: body.public_key, counter: 0 });
    return this.issue(body.device_id);
  };

  /** Device-signed calls (status, refresh, release). */
  fetch = async (url: string, init: any) => {
    const path = new URL(url).pathname.replace('/api/v1', '');
    this.calls.push(path);
    if (!this.reachable) throw new Error('getaddrinfo ENOTFOUND api.example');
    if (this.fault === 'hang') {
      return new Promise<any>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    const reply = (status: number, data: any) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => data, text: async () => '' });
    if (this.fault === 'html') return { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<html>Sign in to Wi-Fi</html>' };
    if (this.fault === 'drop') return { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('socket hang up'); }, text: async () => '' };
    if (this.failWith) return reply(this.failWith, { error: { code: 'error', message: 'down' } });
    if (this.legacy && path === '/licence/status') return reply(404, { error: { code: 'not_found', message: 'Not Found' } });
    const data = JSON.parse(init.body);
    this.bodies.push({ path, data });
    const dev = this.devices.get(data.device_id);
    const sigOk = dev && verify(null, Buffer.from(init.body), createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: dev.publicKey }, format: 'jwk' }), fromB64u(init.headers['X-TrustCode-Device-Signature']));
    if (!sigOk) return reply(401, { error: { code: 'device_not_recognised', message: 'This device is not activated.' } });
    if (data.counter <= dev!.counter) return reply(401, { error: { code: 'replayed_request', message: 'replay' } });
    dev!.counter = data.counter;
    if (this.refusal) return reply(403, { error: { code: this.refusal, message: 'This device was blocked by an administrator.' } });
    if (path === '/licence/release') { this.devices.delete(data.device_id); return reply(200, { status: 'deactivated' }); }
    if (path === '/licence/status') {
      return reply(200, { status: 'ok', rev: this.rev, refresh: data.lid !== dev!.lid || data.rev !== this.rev, check_after: this.checkAfter, server_time: Math.floor(this.clock / 1000) });
    }
    return reply(200, { ...this.issue(data.device_id), rev: this.rev });
  };
  count(path: string) { return this.calls.filter((c) => c === path).length; }
}

export function memorySecrets(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k: string) => m.get(k), store: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

export interface Env { now: number; timers: { fn: () => void; ms: number; at: number }[]; logs: string[]; changes: string[] }

/** Lets pending promise chains (fake network answers, storage writes) finish. */
export const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

/** Moves the injected clock forward, firing the timers that come due on the way (the fake server's clock follows). */
export async function advance(env: Env, ms: number, srv?: FakeServer, stop?: () => boolean): Promise<void> {
  const end = env.now + ms;
  for (;;) {
    const next = env.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    env.timers = env.timers.filter((t) => t !== next);
    env.now = Math.max(env.now, next.at);
    if (srv) srv.clock = env.now;
    next.fn();
    await settle();
    if (stop?.()) return;
  }
  env.now = end;
  if (srv) srv.clock = env.now;
}

export function setup(srv = new FakeServer(), secrets: any = memorySecrets(), extra: Record<string, unknown> = {}) {
  const env: Env = { now: srv.clock, timers: [], logs: [], changes: [] };
  const mk = (Manager: any = LicenceManager): LicenceManager => new Manager({ secrets, fetch: srv.fetch as any, backend: () => 'https://api.example', keys: KEYS, authed: srv.authed,
    onChange: (v: any) => env.changes.push(v.status), log: (m: string) => env.logs.push(m), deviceName: 'Test', platform: 'darwin-arm64', now: () => env.now,
    client: () => ({ v: '1.2.0', build: 'ab'.repeat(32) }),
    schedule: (fn: () => void, ms: number) => { const t = { fn, ms, at: env.now + ms }; env.timers.push(t); return { cancel: () => { env.timers = env.timers.filter((x) => x !== t); } }; },
    ...extra });
  return { srv, secrets, env, mk, m: mk() };
}
