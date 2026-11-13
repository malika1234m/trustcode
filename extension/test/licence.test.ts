// Offline licence behaviour: signature checks, offline periods, clock checks, sync, revocation and storage faults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { ApiError } from '../src/api';
import { BACKOFF_MS } from '../src/licence/manager';
import { evaluate } from '../src/licence/state';
import { fromB64u, verifyLicence } from '../src/licence/token';
import { LICENCE_KEYS } from '../src/licence/keys';
import { b64u, DAY, FakeServer, KEYS, memorySecrets, setup, signToken } from './licence-fake';


test('1-2. first online activation stores a licence that verifies on this device', async () => {
  const { m, mk, secrets } = setup();
  const v = await m.activate();
  assert.equal(v.status, 'active');
  assert.equal(v.plan.id, 'pro');
  assert.ok(m.allows('llm_explanations'));
  const raw = [...secrets.m.values()].join('');
  assert.ok(!raw.includes('password'));
  const again = await mk().load();
  assert.equal(again.status, 'active');
});

test('3, 20. launch and restart without a connection: decided locally, no network call', async () => {
  const { m, mk, srv, env } = setup();
  await m.activate();
  srv.reachable = false;
  env.now += 2 * 3600_000;
  const before = srv.calls.length;
  const v = await mk().load();
  assert.equal(v.plan.id, 'pro');
  assert.equal(srv.calls.length, before, 'loading must not contact the server');
});

test('4-6. offline within the period, warning near the end, paused after it', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.reachable = false;
  env.now += 2 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'offline');
  assert.equal(m.view.plan.id, 'pro');
  env.now += 25 * DAY + 3600_000;          // 27 days in
  await m.sync();
  assert.equal(m.view.status, 'expiring_soon');
  assert.match(m.view.message, /within 3 days/);
  env.now += 4 * DAY;                      // 31 days in
  await m.sync();
  assert.equal(m.view.status, 'connection_required');
  assert.equal(m.view.usable, false, 'after the offline period TrustCode waits for the account to be confirmed');
});

test('7. subscription ends while offline: paid features stop at paid_until even inside the offline period', async () => {
  const srv = new FakeServer();
  srv.paidUntil = srv.clock + 10 * DAY;
  const { m, env } = setup(srv);
  await m.activate();
  srv.reachable = false;
  env.now += 7 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'expiring_soon');
  env.now += 4 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'subscription_expired');
  assert.equal(m.view.plan.id, 'free');
  assert.equal(m.view.usable, true, 'a lapsed paid plan falls back to Free, still registered');
});

test('8-9. after reconnecting, the server decides: cancelled/expired plan comes back as Free', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.plan = { id: 'free', name: 'Free' };
  env.now += 2 * DAY;
  srv.clock = env.now;
  await m.sync();
  assert.equal(m.view.status, 'active');
  assert.equal(m.view.plan.id, 'free');
  assert.ok(!m.allows('llm_explanations'));
});

test('10. revoked device: licence removed, Free keeps working, a fresh sign-in can activate again', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.refusal = 'device_revoked';
  env.now += 2 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'revoked');
  assert.equal(m.view.plan.id, 'free');
  assert.equal(m.view.usable, false);
  assert.match(m.view.message, /Sign in again/);
  srv.refusal = undefined;
  srv.clock = env.now;
  assert.equal((await m.activate()).status, 'active');
});

test('11-12. modified licence or invalid signature is rejected and the plan falls back to Free', async () => {
  const { m, mk, secrets } = setup();
  await m.activate();
  const key = [...secrets.m.keys()].find((k) => k.startsWith('trustcode.licence:'))!;
  const rec = JSON.parse(secrets.m.get(key)!);
  const [h, body, sig] = rec.token.split('.');
  const p = JSON.parse(fromB64u(body).toString());
  p.offline_until += 3650 * 86400;
  rec.token = [h, b64u(Buffer.from(JSON.stringify(p))), sig].join('.');
  secrets.m.set(key, JSON.stringify(rec));
  const v = await mk().load();
  assert.equal(v.status, 'sign_in_required');
  assert.equal(v.usable, false);
  const other = generateKeyPairSync('ed25519');
  assert.deepEqual(verifyLicence(signToken(p, other.privateKey), KEYS), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(verifyLicence(signToken({ ...p, kid: 'nope' }), KEYS), { ok: false, reason: 'unknown_key' });
  assert.deepEqual(verifyLicence('tcl1.@@.x', KEYS), { ok: false, reason: 'malformed' });
});

test('licence copied from another device is not accepted', async () => {
  const a = setup();
  await a.m.activate();
  const key = [...a.secrets.m.keys()].find((k) => k.startsWith('trustcode.licence:'))!;
  const b = setup(a.srv, memorySecrets({ [key]: a.secrets.m.get(key)! }));
  assert.equal((await b.m.load()).plan.id, 'free');
});

test('13. clock turned back is noticed; a server time anchor repairs it', async () => {
  const { m, mk, env } = setup();
  await m.activate();
  env.now += 3 * DAY;
  await mk().load();               // remembers the later time
  env.now -= 2 * DAY;              // user turns the clock back
  const back = mk();
  const v = await back.load();
  assert.equal(v.status, 'connection_required');
  assert.ok(v.clockProblem);
  assert.equal(v.plan.id, 'free');
  // future-dated clock relative to the licence is fine; a licence issued "in the future" is not
  assert.equal(evaluate({ payload: m.payload, nowMs: m.payload!.iat * 1000 - DAY, clockFloorMs: 0, offline: true }).status, 'connection_required');
});

test('14. device limit reached is reported to the caller', async () => {
  const srv = new FakeServer();
  srv.maxDevices = 0;
  const { m } = setup(srv);
  await assert.rejects(m.activate(), (e: any) => e.code === 'device_limit_reached');
  assert.equal(m.view.plan.id, 'free');
});

test('15. sign-out releases the device on the server and removes the licence', async () => {
  const { m, srv } = setup();
  await m.activate();
  assert.equal(srv.devices.size, 1);
  await m.release();
  assert.equal(srv.devices.size, 0);
  assert.equal(m.view.status, 'sign_in_required');
  assert.equal(m.view.usable, false);
});

test('16. corrupted storage is reset safely', async () => {
  const secrets = memorySecrets({ 'trustcode.licence:https://api.example': '{not json', 'trustcode.licence.device': '[]' });
  const { m } = setup(undefined, secrets);
  const v = await m.load();
  assert.equal(v.status, 'sign_in_required');
  assert.ok(!secrets.m.has('trustcode.licence:https://api.example') || JSON.parse(secrets.m.get('trustcode.licence:https://api.example')!));
  assert.equal((await m.activate()).status, 'active', 'a broken device record is replaced');
});

test('17, 19. connection drops or server fails during sync: licence kept, retry with back-off', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  env.now += 2 * DAY;
  srv.failWith = 503;
  await m.sync();
  assert.equal(m.view.status, 'offline');
  assert.equal(m.view.plan.id, 'pro');
  const first = env.timers.at(-1)!.ms;
  assert.ok(first >= BACKOFF_MS[0] * 0.8 && first <= BACKOFF_MS[0] * 1.2);
  srv.failWith = undefined;
  srv.reachable = false;
  await m.sync();
  const second = env.timers.at(-1)!.ms;
  assert.ok(second >= BACKOFF_MS[1] * 0.8, 'back-off grows');
  assert.equal(env.timers.filter((t) => t.ms < 15 * 60_000 && t.ms > 30_000).length, 1, 'only one pending retry');
});

test('18. reconnecting after several days refreshes the licence without signing in', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.reachable = false;
  env.now += 6 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'offline');
  srv.reachable = true;
  srv.clock = env.now;
  await m.sync();
  assert.equal(m.view.status, 'active');
  assert.equal(m.view.offlineUntil, Math.floor(env.now / 1000) * 1000 + 30 * DAY);
});

test('no network call when the licence is not yet due', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  const n = srv.calls.length;
  env.now += 30 * 60_000;                 // the status check is due after an hour, the refresh after a day
  await m.sync();
  assert.equal(srv.calls.length, n);
  await m.sync(true);
  assert.equal(srv.calls.length, n + 1);
  assert.equal(srv.calls.at(-1), '/licence/refresh');
});

test('without a licence nothing runs: a registered account is required', () => {
  const v = evaluate({ nowMs: Date.now(), clockFloorMs: 0, offline: true });
  assert.equal(v.status, 'sign_in_required');
  assert.equal(v.usable, false);
  assert.match(v.message, /free/);
});

test('a registered Free account is usable, online and offline within the period', async () => {
  const srv = new FakeServer();
  srv.plan = { id: 'free', name: 'Free' };
  const { m, env } = setup(srv);
  assert.equal((await m.activate()).usable, true);
  srv.reachable = false;
  env.now += 20 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'offline');
  assert.equal(m.view.usable, true);
  env.now += 6 * DAY;
  await m.sync();
  assert.equal(m.view.status, 'expiring_soon', 'free accounts are warned before the offline period ends too');
});

test('at startup the status is confirmed online unless the server answered in the last few minutes', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  const n = srv.calls.length;
  env.now += 2 * 60_000;
  await m.sync(false, 5 * 60_000);
  assert.equal(srv.calls.length, n, 'the server answered 2 minutes ago: no call');
  env.now += 10 * 60_000;
  srv.clock = env.now;
  await m.sync(false, 5 * 60_000);
  assert.deepEqual(srv.calls.slice(n), ['/licence/status'], 'one small status call, no new licence');
});

test('a deleted account is noticed at the next online check and TrustCode stops', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.devices.clear();                 // account deleted: the server no longer knows the device
  env.now += 2 * DAY;
  await m.sync();
  assert.equal(m.view.usable, false);
  assert.equal(m.view.status, 'revoked');
});

test('the shipped verification key is a valid Ed25519 public key', () => {
  for (const x of Object.values(LICENCE_KEYS)) assert.doesNotThrow(() => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }));
});

test('account card shows the plan in force and escapes server text', async () => {
  const { licenceCard } = await import('../src/ui');
  const html = licenceCard({ status: 'revoked', usable: false, plan: { id: 'free', name: 'Free' }, licensedPlan: { id: 'pro', name: '<b>Pro</b>' }, features: {},
    message: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'));
  assert.match(html, /Signed out/);
});
