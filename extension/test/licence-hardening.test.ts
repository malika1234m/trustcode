// Licence hardening scenarios (1.2.0): startup, offline periods, clock changes, revocation timing, storage tampering,
// network faults, key rotation, integrity signals and notification limits. Clock, storage and network are injected.
// Tests named "MEASURED ..." print the measured value as a diagnostic line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'crypto';
import { TrustCodeApi } from '../src/api';
import { buildHash } from '../src/licence/build';
import { DEFAULT_CHECK_MS, STARTUP_DELAY_MS, STARTUP_MAX_AGE_MS, TICK_MS } from '../src/licence/manager';
import { evaluate, noticeDue } from '../src/licence/state';
import { fromB64u, verifyLicence } from '../src/licence/token';
import { advance, b64u, DAY, FakeServer, HOUR, KEYS, memorySecrets, MINUTE, server, settle, setup, signToken } from './licence-fake';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LICENCE_KEY = 'trustcode.licence:https://api.example';
const DEVICE_KEY = 'trustcode.licence.device';
/** Pending retry timers (the regular startup and tick timers are not retries). */
const retries = (env: { timers: { ms: number }[] }) => env.timers.filter((t) => t.ms !== STARTUP_DELAY_MS && t.ms !== TICK_MS);
const free = () => { const s = new FakeServer(); s.plan = { id: 'free', name: 'Free' }; return s; };

// ---------------------------------------------------------------------------------------------- startup
test('startup: first start with no account is blocked and makes no network call, now or later', async () => {
  const { m, srv, env } = setup();
  const v = await m.load();
  assert.equal(v.status, 'sign_in_required');
  assert.equal(v.usable, false);
  assert.equal(m.usable(), false);
  assert.equal(m.allows('llm_explanations'), false);
  assert.equal(await m.proof(), undefined, 'no device proof without an account');
  m.startTimers();
  await advance(env, 2 * DAY, srv);
  assert.equal(srv.calls.length, 0, 'signed out: the background timers contact nobody');
});

test('startup: sign in, activate, then every feature is available', async () => {
  const { m, srv } = setup(free());
  await m.load();
  const v = await m.activate();
  assert.equal(v.status, 'active');
  assert.equal(m.usable(), true);
  assert.equal(srv.count('/licence/activate'), 1);
  const sent = srv.bodies[0].data;
  assert.equal(sent.version, '1.2.0');
  assert.equal(sent.build, 'ab'.repeat(32), 'activation reports the build');
});

test('startup: restart offline is decided locally with zero network calls', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  srv.reachable = false;
  env.now += 3 * DAY;
  const before = srv.calls.length;
  const next = mk();
  const v = await next.load();
  assert.equal(v.usable, true);
  assert.equal(srv.calls.length, before, 'load() never touches the network');
});

test('startup: the status is confirmed 15 seconds after start, not during it', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  m.dispose();                               // the editor was closed
  env.now += 2 * HOUR; srv.clock = env.now;
  const next = mk();
  await next.load();
  const before = srv.calls.length;
  next.startTimers();
  assert.equal(srv.calls.length, before);
  await advance(env, STARTUP_DELAY_MS - 1, srv);
  assert.equal(srv.calls.length, before, 'nothing before the delay');
  await advance(env, 2, srv);
  assert.deepEqual(srv.calls.slice(before), ['/licence/status']);
  next.dispose();
});

test('startup: a window reload within a few minutes of the last answer makes no call', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  m.dispose();
  env.now += STARTUP_MAX_AGE_MS - MINUTE;
  const next = mk();
  await next.load();
  const before = srv.calls.length;
  next.startTimers();
  await advance(env, STARTUP_DELAY_MS + 1, srv);
  assert.equal(srv.calls.length, before);
  next.dispose();
});

// ---------------------------------------------------------------------------------------------- offline period
for (const [day, status, usable, left] of [[1, 'offline', true, 29], [24, 'offline', true, 6], [25, 'expiring_soon', true, 5], [29, 'expiring_soon', true, 1],
  [30, 'connection_required', false, undefined], [31, 'connection_required', false, undefined]] as const) {
  test(`offline for ${day} days: ${status}, ${usable ? 'works' : 'blocked'}`, async () => {
    const { m, srv, env } = setup(free());
    await m.activate();
    srv.reachable = false;
    env.now += day * DAY;
    await m.sync();
    assert.equal(m.view.status, status);
    assert.equal(m.view.usable, usable);
    if (left !== undefined) assert.equal(m.view.daysLeft, left);
    if (status === 'expiring_soon') assert.match(m.view.message, new RegExp(`within ${left} day`));
    if (!usable) assert.match(m.view.message, /offline for 30 days/);
  });
}

for (const n of [1, 25, 29, 30, 31, 400]) {
  test(`online again after ${n} days offline: refreshed without a new sign-in`, async () => {
    const { m, mk, srv, env } = setup(free());
    await m.activate();
    srv.reachable = false;
    env.now += n * DAY;
    const next = mk();                       // also across a restart
    await next.load();
    await next.sync();
    srv.reachable = true; srv.clock = env.now;
    await next.sync();
    assert.equal(next.view.status, 'active');
    assert.equal(next.view.usable, true);
    assert.equal(next.view.offlineUntil, Math.floor(env.now / 1000) * 1000 + 30 * DAY, 'a fresh offline period');
    assert.equal(srv.count('/licence/activate'), 1, 'no second sign-in or activation');
  });
}

test('a per-account offline period from the server is honoured (7 days)', async () => {
  const srv = free(); srv.grace = 7;
  const { m, env } = setup(srv);
  await m.activate();
  srv.reachable = false;
  env.now += 6 * DAY; await m.sync();
  assert.equal(m.view.usable, true);
  env.now += 1 * DAY; await m.sync();
  assert.equal(m.view.usable, false);
  assert.match(m.view.message, /offline for 7 days/);
});

// ---------------------------------------------------------------------------------------------- clock
test('clock turned back: blocked until the account is confirmed online, then repaired', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  const t0 = env.now;
  env.now = t0 + 3 * DAY;
  await mk().load();                         // TrustCode ran at day 3: the latest trusted time is remembered
  env.now = t0 + 1 * DAY;                    // clock set back two days
  srv.reachable = false;
  const next = mk();
  const v = await next.load();
  assert.equal(v.status, 'connection_required');
  assert.equal(v.clockProblem, true);
  assert.equal(v.usable, false);
  assert.match(v.message, /date and time/);
  srv.reachable = true; srv.clock = env.now;
  await next.sync();
  assert.equal(next.view.status, 'active', 'the server time is the anchor');
});

test('clock turned back before the licence was issued is blocked (signed issue time)', async () => {
  const { m, mk, env, secrets } = setup(free());
  await m.activate();
  const rec = JSON.parse(secrets.m.get(LICENCE_KEY)!);
  rec.clockFloor = 0;                        // the stored floor is wiped by hand
  secrets.m.set(LICENCE_KEY, JSON.stringify(rec));
  env.now -= 2 * DAY;
  const v = await mk().load();
  assert.equal(v.clockProblem, true, 'the issue time inside the signed licence still bounds the clock');
});

test('clock turned forward and then corrected: blocked offline, repaired by the next online check', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  const t0 = env.now;
  srv.reachable = false;
  env.now = t0 + 400 * DAY;                  // clock far in the future
  const wrong = mk();
  assert.equal((await wrong.load()).status, 'connection_required', 'past the offline period by this clock');
  env.now = t0 + HOUR;                       // corrected
  const fixed = mk();
  const v = await fixed.load();
  assert.equal(v.usable, false, 'cannot be told apart from a clock turned back while offline');
  assert.equal(v.clockProblem, true);
  srv.reachable = true; srv.clock = env.now;
  await fixed.sync();
  assert.equal(fixed.view.status, 'active');
  assert.equal(srv.count('/licence/activate'), 1, 'no new sign-in');
});

test('clock a few minutes fast and then corrected is tolerated (10 minute tolerance)', async () => {
  const { m, mk, env } = setup(free());
  await m.activate();
  const t0 = env.now;
  env.now = t0 + 45 * MINUTE; await mk().load();
  env.now = t0 + 36 * MINUTE;                // set back nine minutes
  assert.equal((await mk().load()).usable, true);
});

test('time zone change does not affect the licence', async () => {
  const { m, mk, env } = setup(free());
  await m.activate();
  env.now += 29 * DAY + 23 * HOUR;
  const saved = process.env.TZ;
  try {
    const seen: { tz: string; offset: number; status: string; left?: number }[] = [];
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC']) {
      process.env.TZ = tz;
      const v = await mk().load();
      seen.push({ tz, offset: new Date(env.now).getTimezoneOffset(), status: v.status, left: v.daysLeft });
    }
    assert.ok(new Set(seen.map((s) => s.offset)).size >= 3, 'the zones really differ in this process');
    assert.equal(new Set(seen.map((s) => `${s.status}/${s.left}`)).size, 1, JSON.stringify(seen));
    assert.equal(seen[0].status, 'active');
  } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
});

test('daylight-saving change: the offline period is exact elapsed time, and the repeated hour is not a clock rollback', async () => {
  const saved = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    for (const start of [Date.UTC(2026, 9, 31, 12), Date.UTC(2026, 2, 7, 12)]) {   // clocks go back on 1 Nov, forward on 8 Mar
      const srv = free(); srv.clock = start; srv.grace = 1;
      const { m, mk, env } = setup(srv);
      await m.activate();
      assert.notEqual(new Date(start).getTimezoneOffset(), new Date(start + DAY).getTimezoneOffset(), 'a DST change lies inside the period');
      for (let h = 1; h < 24; h++) {         // every hour across the change, with a restart each time
        env.now = start + h * HOUR;
        const v = await mk().load();
        assert.equal(v.usable, true, `hour ${h}`);
        assert.equal(v.clockProblem, undefined, `hour ${h}`);
      }
      env.now = start + DAY - 1000;
      assert.equal((await mk().load()).usable, true);
      env.now = start + DAY;
      assert.equal((await mk().load()).usable, false, 'ends exactly 24 hours after issue, whatever the local clock shows');
    }
  } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
});

// ---------------------------------------------------------------------------------------------- revocation online
async function steady(srvIn = free()) {
  const s = setup(srvIn);
  await s.m.activate();
  s.m.startTimers();
  await advance(s.env, 5 * HOUR, s.srv);     // running normally for a while
  return s;
}

for (const [what, apply] of [['device revoked by an administrator', (s: FakeServer) => { s.refusal = 'device_revoked'; }],
  ['account suspended', (s: FakeServer) => { s.refusal = 'account_suspended'; }],
  ['account deleted', (s: FakeServer) => { s.devices.clear(); }]] as const) {
  test(`MEASURED revocation while online (${what}): stops at the next status check`, async (t) => {
    const { m, srv, env } = await steady();
    // worst case: the change happens just after a status check
    const n = srv.count('/licence/status');
    await advance(env, 2 * HOUR, srv, () => srv.count('/licence/status') > n);
    assert.equal(m.view.usable, true);
    const t0 = env.now;
    apply(srv);
    await advance(env, 6 * HOUR, srv, () => !m.view.usable);
    const delay = env.now - t0;
    t.diagnostic(`${what}: stopped ${delay / MINUTE} minutes after the change (worst case, status interval ${DEFAULT_CHECK_MS / MINUTE} min, tick ${TICK_MS / MINUTE} min)`);
    assert.equal(m.view.usable, false);
    assert.equal(m.view.status, 'revoked');
    assert.ok(delay <= DEFAULT_CHECK_MS + TICK_MS, `stopped after ${delay / MINUTE} min`);
    assert.equal(await m.proof(), undefined, 'no device proof after revocation');
    m.dispose();
  });
}

test('MEASURED revocation noticed on traffic the extension already makes (revocation version): no waiting', async (t) => {
  const { m, srv, env } = await steady();
  const t0 = env.now, calls = srv.calls.length;
  srv.refusal = 'device_revoked'; srv.rev += 1;
  m.noteRev(srv.rev);                        // the header on any signed-in response
  await settle();
  t.diagnostic(`stopped ${(env.now - t0) / 1000} s after the response, with ${srv.calls.length - calls} request`);
  assert.equal(m.view.usable, false);
  assert.equal(srv.calls.length - calls, 1);
  m.dispose();
});

test('MEASURED revocation noticed at the next start: 15 seconds after startup', async (t) => {
  const { m, mk, srv, env } = await steady();
  m.dispose();
  srv.refusal = 'device_revoked';
  env.now += 20 * MINUTE; srv.clock = env.now;
  const next = mk();
  assert.equal((await next.load()).usable, true, 'still decided locally at startup');
  next.startTimers();
  const t0 = env.now;
  await advance(env, HOUR, srv, () => !next.view.usable);
  t.diagnostic(`stopped ${(env.now - t0) / 1000} s after startup`);
  assert.equal(env.now - t0, STARTUP_DELAY_MS);
  next.dispose();
});

test('MEASURED traffic when nothing changes: one small status call per interval and one refresh per day', async (t) => {
  const { m, srv, env } = setup(free());
  await m.activate();
  m.startTimers();
  const before = srv.calls.length;
  await advance(env, 24 * HOUR + TICK_MS, srv);   // one full day, to the tick on which the daily refresh falls
  const status = srv.count('/licence/status'), refresh = srv.count('/licence/refresh');
  t.diagnostic(`24 hours online, nothing changed: ${status} status calls, ${refresh} refresh, ${srv.calls.length - before} requests in total`);
  assert.ok(status >= 20 && status <= 24, `status calls: ${status}`);
  assert.equal(refresh, 1);
  m.dispose();
});

test('revocation version: nothing changed means no request; a change means exactly one refresh', async () => {
  const { m, srv } = setup();
  await m.activate();
  const n = srv.calls.length;
  m.noteRev(0); m.noteRev(0);
  await settle();
  assert.equal(srv.calls.length, n, 'same version: no request');
  srv.plan = { id: 'free', name: 'Free' }; srv.rev = 1;   // an administrator changed the plan
  m.noteRev(1); m.noteRev(1); m.noteRev(1);
  await settle();
  assert.deepEqual(srv.calls.slice(n), ['/licence/refresh']);
  assert.equal(m.view.plan.id, 'free');
  assert.equal(m.payload?.rev, 1);
  m.noteRev(1);
  await settle();
  assert.equal(srv.calls.length, n + 1);
});

test('status check that reports a newer licence triggers one refresh (plan changed by an administrator)', async () => {
  const { m, srv, env } = setup();
  await m.activate();
  srv.plan = { id: 'team', name: 'Team' }; srv.rev = 5;
  env.now += 61 * MINUTE; srv.clock = env.now;
  const n = srv.calls.length;
  await m.sync();
  assert.deepEqual(srv.calls.slice(n), ['/licence/status', '/licence/refresh']);
  assert.equal(m.view.plan.id, 'team');
});

test('status and refresh requests carry the licence id, revocation version, extension version and build', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  env.now += 61 * MINUTE; srv.clock = env.now;
  await m.sync();
  const s = srv.bodies.at(-1)!;
  assert.equal(s.path, '/licence/status');
  assert.equal(s.data.v, '1.2.0'); assert.equal(s.data.build, 'ab'.repeat(32));
  assert.equal(s.data.lid, m.payload!.lid); assert.equal(s.data.rev, 0);
});

test('a signed-in request refused as unauthorised triggers one status check (at most one a minute)', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  const n = srv.calls.length;
  env.now += 1000; srv.devices.clear();      // account deleted on the server
  m.noteUnauthorized(); m.noteUnauthorized();
  await settle();
  assert.deepEqual(srv.calls.slice(n), ['/licence/status']);
  assert.equal(m.view.usable, false);
});

test('a server from before the status call: falls back to the daily refresh, without hourly traffic', async () => {
  const srv = free(); srv.legacy = true;
  const { m, env } = setup(srv);
  await m.activate();
  m.startTimers();
  await advance(env, 24 * HOUR, srv);
  assert.equal(m.view.usable, true);
  assert.equal(srv.count('/licence/status'), 1, 'asked once, then remembered that it is not there');
  assert.ok(srv.count('/licence/refresh') <= 2, `refreshes in a day: ${srv.count('/licence/refresh')}`);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------- revocation offline
test('revocation while offline: works until the offline period ends, then stops; online it is refused', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  m.startTimers();
  srv.reachable = false; srv.refusal = 'device_revoked';
  await advance(env, 29 * DAY + 23 * HOUR, srv);
  assert.equal(m.view.usable, true, 'still inside the offline period');
  assert.equal(m.view.status, 'expiring_soon');
  await advance(env, 2 * HOUR, srv);
  assert.equal(m.view.usable, false);
  assert.equal(m.view.status, 'connection_required');
  srv.reachable = true;
  await m.sync();
  assert.equal(m.view.status, 'revoked');
  m.dispose();
});

test('paid plan that ended while offline: Free until the offline period ends, then blocked like any other device', async () => {
  const srv = new FakeServer();                         // Pro, 30 offline days
  srv.paidUntil = srv.clock + 10 * DAY;
  const { m, env } = setup(srv);
  await m.activate();
  m.startTimers();
  srv.reachable = false;
  await advance(env, 11 * DAY, srv);
  assert.deepEqual([m.view.status, m.view.usable, m.view.plan.id], ['subscription_expired', true, 'free'], 'the paid plan ended: Free keeps working');
  await advance(env, 18 * DAY + 23 * HOUR, srv);
  assert.equal(m.view.usable, true, 'still inside the offline period');
  await advance(env, 2 * HOUR, srv);
  assert.deepEqual([m.view.status, m.view.usable], ['connection_required', false], 'the offline period ended: nothing runs, whatever the plan was');
  env.now += 300 * DAY;
  await advance(env, HOUR, srv);
  assert.equal(m.view.usable, false, 'and it stays blocked for as long as the account is not confirmed');
  srv.reachable = true; srv.clock = env.now; srv.plan = { id: 'free', name: 'Free' };
  await m.sync();
  assert.deepEqual([m.view.status, m.view.usable, m.view.plan.id], ['active', true, 'free'], 'confirmed online again: Free, no new sign-in');
  m.dispose();
});

test('paid plan, device removed while offline: it stops when the offline period ends (the time administrators are shown)', async () => {
  for (const paidDays of [10, 30, 60]) {               // paid period ending before, with and after the offline period
    const srv = new FakeServer();
    srv.paidUntil = srv.clock + paidDays * DAY;
    const { m, env } = setup(srv);
    await m.activate();
    const stopsBy = m.view.offlineUntil!;
    m.startTimers();
    srv.reachable = false; srv.refusal = 'device_revoked';
    await advance(env, stopsBy - env.now - HOUR, srv);
    assert.equal(m.view.usable, true, `paid for ${paidDays} days: usable until the offline period ends`);
    await advance(env, 2 * HOUR, srv);
    assert.equal(m.view.usable, false, `paid for ${paidDays} days: stopped at the end of the offline period`);
    env.now += 400 * DAY;
    await advance(env, HOUR, srv);
    assert.equal(m.view.usable, false);
    m.dispose();
  }
});

test('evaluate: after the offline period no licence is usable, for every plan and paid period', () => {
  const iat = Math.floor(Date.UTC(2026, 10, 13) / 1000);
  for (const plan of ['free', 'pro', 'team']) for (const paid of [null, iat + 5 * 86400, iat + 30 * 86400, iat + 400 * 86400]) {
    const payload: any = { v: 1, kid: 't1', lid: 'l', sub: 'a'.repeat(32), dev: 'd'.repeat(32), plan: { id: plan, name: plan }, state: 'active', features: { x: true }, limits: {},
      act: iat, iat, validated_at: iat, grace_days: 30, offline_until: iat + 30 * 86400, paid_until: plan === 'free' ? null : paid, refresh_after: iat + 86400 };
    for (const offline of [true, false]) for (const after of [0, 1, 86400, 365 * 86400]) {
      const v = evaluate({ payload, nowMs: (payload.offline_until + after) * 1000, clockFloorMs: 0, offline });
      assert.deepEqual([v.usable, v.status, v.plan.id, v.features], [false, 'connection_required', 'free', {}], `${plan}, paid until ${paid}, ${after} s after the offline period`);
    }
  }
});

// ---------------------------------------------------------------------------------------------- storage tampering
test('storage: an edited licence is rejected', async () => {
  const { m, mk, secrets } = setup(free());
  await m.activate();
  const rec = JSON.parse(secrets.m.get(LICENCE_KEY)!);
  const [h, body, sig] = rec.token.split('.');
  const p = JSON.parse(fromB64u(body).toString());
  p.offline_until += 3650 * 86400; p.plan = { id: 'team', name: 'Team' };
  rec.token = [h, b64u(Buffer.from(JSON.stringify(p))), sig].join('.');
  secrets.m.set(LICENCE_KEY, JSON.stringify(rec));
  const v = await mk().load();
  assert.equal(v.status, 'sign_in_required');
  assert.equal(v.usable, false);
  assert.equal(JSON.parse(secrets.m.get(LICENCE_KEY)!).token, undefined, 'the rejected licence is removed');
});

test('storage: a licence copied from another device is rejected, with or without that device\'s key', async () => {
  const a = setup(free());
  await a.m.activate();
  const b = setup(a.srv);                    // a second computer, own key
  await b.m.activate();
  b.secrets.m.set(LICENCE_KEY, a.secrets.m.get(LICENCE_KEY)!);
  const v = await b.mk().load();
  assert.equal(v.usable, false);
  assert.ok(b.env.logs.some((l) => /another device/.test(l)));
});

test('storage: device key deleted means sign in again; a fresh activation works', async () => {
  const { m, mk, secrets, srv } = setup(free());
  await m.activate();
  secrets.m.delete(DEVICE_KEY);
  const next = mk();
  assert.equal((await next.load()).status, 'sign_in_required');
  const calls = srv.calls.length;
  await next.sync(true);
  assert.equal(srv.calls.length, calls, 'nothing is sent without a device key');
  assert.equal((await next.activate()).status, 'active');
});

for (const [name, value] of [['not JSON', '{{{'], ['null', 'null'], ['an array', '[1,2]'], ['a number', '7'], ['wrong field types', '{"token":123,"clockFloor":"x","revoked":"yes","offline":"no"}'],
  ['an empty string', '']] as const) {
  test(`storage: corrupted licence record (${name}) is handled without an error`, async () => {
    const { mk, secrets } = setup(free(), memorySecrets({ [LICENCE_KEY]: value, [DEVICE_KEY]: value }));
    const m = mk();
    const v = await m.load();
    assert.equal(v.status, 'sign_in_required');
    assert.equal(v.usable, false);
    assert.equal((await m.activate()).status, 'active', 'signing in recovers');
    assert.ok(JSON.parse(secrets.m.get(LICENCE_KEY)!).token);
  });
}

test('storage: SecretStorage unavailable never throws; blocked until sign-in, then works for the session only', async () => {
  const broken = { get: async () => { throw new Error('keychain locked'); }, store: async () => { throw new Error('keychain locked'); }, delete: async () => { throw new Error('keychain locked'); } };
  const { mk, srv, env } = setup(free(), broken);
  const m = mk();
  const v = await m.load();
  assert.equal(v.usable, false);
  assert.equal((await m.activate()).usable, true, 'works in memory for this session');
  env.now += 2 * HOUR; srv.clock = env.now;
  await m.sync();
  assert.equal(m.view.usable, true);
  await m.release();
  assert.equal((await mk().load()).usable, false, 'nothing was kept');
  assert.equal(env.logs.filter((l) => /secret storage is not available/.test(l)).length <= 2, true, 'logged, not repeated endlessly');
});

// ---------------------------------------------------------------------------------------------- tampered tokens, key rotation
test('tampered tokens are all rejected by the extension', async () => {
  const srv = free();
  srv.devices.set('d'.repeat(32), { publicKey: '', counter: 0 });
  const good = srv.issue('d'.repeat(32)).licence;
  srv.clock += 1000;
  const other = srv.issue('d'.repeat(32)).licence;
  const [h, body, sig] = good.split('.');
  const attacker = generateKeyPairSync('ed25519');
  const p = JSON.parse(fromB64u(body).toString());
  const cases: Record<string, [string, string]> = {
    'payload edited': [[h, b64u(Buffer.from(JSON.stringify({ ...p, plan: { id: 'team', name: 'Team' } }))), sig].join('.'), 'bad_signature'],
    'signature swapped with another licence\'s': [[h, body, other.split('.')[2]].join('.'), 'bad_signature'],
    'signed by an attacker\'s key under the real key id': [signToken(p, attacker.privateKey), 'bad_signature'],
    'key id changed to an unknown one': [signToken({ ...p, kid: 'zz' }, attacker.privateKey), 'unknown_key'],
    'key id changed to __proto__': [signToken({ ...p, kid: '__proto__' }, attacker.privateKey), 'unknown_key'],
    'prefix changed': [['tcl2', body, sig].join('.'), 'malformed'],
    'algorithm marker added': [['tcl1', body, sig, 'none'].join('.'), 'malformed'],
    'signature removed': [[h, body, ''].join('.'), 'malformed'],
    'truncated': [good.slice(0, good.length - 20), 'bad_signature'],
    'truncated in the payload': [good.slice(0, 40), 'malformed'],
    'empty': ['', 'malformed'],
    'oversized': ['tcl1.' + 'A'.repeat(9000) + '.' + sig, 'malformed'],
    'authentic signature over a payload with missing fields': [signToken({ v: 1, kid: 't1' }), 'unsupported'],
    'authentic signature, unsupported version': [signToken({ ...p, v: 2 }), 'unsupported'],
  };
  assert.equal(verifyLicence(good, KEYS).ok, true);
  for (const [name, [token, reason]] of Object.entries(cases)) {
    const r = verifyLicence(token, KEYS);
    assert.equal(r.ok, false, name);
    assert.equal((r as any).reason, reason, name);
  }
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(verifyLicence(bad as any, KEYS).ok, false);
});

test('key rotation: the old key still verifies, the new key is used for new licences, an unknown key id is rejected', async () => {
  const k2 = generateKeyPairSync('ed25519');
  const both = { ...KEYS, t2: (k2.publicKey.export({ format: 'jwk' }) as any).x as string };
  const srv = free();
  const s = setup(srv, memorySecrets(), { keys: both });
  await s.m.activate();
  assert.equal(s.m.payload!.kid, 't1');
  srv.kid = 't2'; srv.key = k2.privateKey;   // the server switches to the new key
  s.env.now += 2 * DAY; srv.clock = s.env.now;
  const old = s.mk();
  assert.equal((await old.load()).usable, true, 'a licence signed with the old key still verifies');
  await old.sync();
  assert.equal(old.payload!.kid, 't2', 'the refreshed licence is signed with the new key');
  assert.equal(old.view.status, 'active');
  // an extension that only knows the old key cannot accept the new key: it keeps its licence and reports the failure
  const stale = setup(srv, s.secrets, { keys: KEYS });
  stale.env.now = s.env.now;
  assert.equal((await stale.m.load()).status, 'sign_in_required', 'unknown key id: rejected');
  assert.equal(verifyLicence(signToken({ ...old.payload, kid: 't1' }, k2.privateKey), both).ok, false, 'new key under the old id is not accepted');
});

// ---------------------------------------------------------------------------------------------- network faults
const FAULTS: [string, (s: FakeServer) => void][] = [
  ['timeout mid-request', (s) => { s.fault = 'hang'; }],
  ['server 500', (s) => { s.failWith = 500; }],
  ['server 503', (s) => { s.failWith = 503; }],
  ['server 429', (s) => { s.failWith = 429; }],
  ['DNS failure', (s) => { s.reachable = false; }],
  ['captive portal returning HTML', (s) => { s.fault = 'html'; }],
  ['connection dropping while the answer is read', (s) => { s.fault = 'drop'; }],
];
for (const [name, apply] of FAULTS) {
  for (const during of ['status check', 'refresh'] as const) {
    test(`network fault during a ${during}: ${name} keeps the licence and retries with back-off`, async () => {
      const { m, mk, srv, env, secrets } = setup(free(), memorySecrets(), { timeoutMs: 25 });
      await m.activate();
      env.now += during === 'refresh' ? 2 * DAY : 2 * HOUR; srv.clock = env.now;
      const token = JSON.parse(secrets.m.get(LICENCE_KEY)!).token;
      apply(srv);
      const started = Date.now();
      await m.sync();
      assert.ok(Date.now() - started < 2000, 'a fault never hangs the check');
      assert.equal(m.view.usable, true, 'still usable');
      assert.equal(m.view.status, 'offline');
      assert.equal(JSON.parse(secrets.m.get(LICENCE_KEY)!).token, token, 'the licence is kept');
      assert.equal(retries(env).length, 1, 'exactly one retry is pending');
      assert.ok(retries(env)[0].ms >= 48_000 && retries(env)[0].ms <= 72_000, 'first retry after about a minute');
      assert.equal((await mk().load()).usable, true, 'and after a restart');
      // the fault clears: the next attempt succeeds without signing in
      srv.fault = undefined; srv.failWith = undefined; srv.reachable = true;
      env.now += MINUTE; srv.clock = env.now;
      await m.sync();
      assert.equal(m.view.status, 'active');
      assert.equal(srv.count('/licence/activate'), 1);
    });
  }
}

test('a captive portal cannot make the extension drop its licence or accept a fake one', async () => {
  const { m, srv, env, secrets } = setup(free());
  await m.activate();
  env.now += 2 * DAY;
  const attacker = generateKeyPairSync('ed25519');
  const fake = signToken({ ...m.payload, plan: { id: 'team', name: 'Team' }, offline_until: m.payload!.offline_until + 10 * 365 * 86400 }, attacker.privateKey);
  const real = srv.fetch;
  srv.fetch = (async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ licence: fake, server_time: 1 }), text: async () => '' })) as any;
  const forged = setup(srv, secrets);         // same storage, forged network
  forged.env.now = env.now;
  await forged.m.load();
  await forged.m.sync(true);
  assert.equal(forged.m.view.plan.id, 'free', 'the forged licence is not accepted');
  assert.equal(forged.m.view.usable, true, 'and the real one is kept');
  srv.fetch = real;
});

test('repeated failures back off (1, 2, 4 ... minutes, capped at 6 hours) with a single pending retry', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  srv.reachable = false;
  env.now += 2 * HOUR;
  const delays: number[] = [];
  for (let i = 0; i < 12; i++) { await m.sync(); assert.equal(retries(env).length, 1); delays.push(retries(env)[0].ms / MINUTE); env.now += MINUTE; }
  for (let i = 1; i < 6; i++) assert.ok(delays[i] > delays[i - 1] * 1.2, `grows: ${delays.map((d) => d.toFixed(1))}`);
  assert.ok(Math.max(...delays) <= 360 * 1.2);
});

// ---------------------------------------------------------------------------------------------- UI and behaviour
test('the licence is loaded without waiting for the network, even when the network never answers', async () => {
  const { m, mk, srv, env } = setup(free());
  await m.activate();
  srv.fault = 'hang';
  env.now += 2 * DAY;
  const next = mk();
  const started = Date.now();
  const v = await next.load();
  assert.ok(Date.now() - started < 200, 'load() returns at once');
  assert.equal(v.usable, true);
  let finished = false;
  const pending = next.sync().then(() => { finished = true; });   // background; the caller is never blocked by it
  await settle();
  assert.equal(finished, false, 'the check is still waiting for the network while the editor carries on');
  assert.equal(next.view.usable, true);
  next.dispose();
  void pending;
});

test('simultaneous checks share one request', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  env.now += 2 * HOUR; srv.clock = env.now;
  const n = srv.calls.length;
  await Promise.all([m.sync(), m.sync(), m.sync(), m.sync()]);
  assert.equal(srv.calls.length, n + 1);
});

test('notifications: at most one per state per day, also when states alternate', () => {
  let seen: unknown;
  let shown = 0;
  const t0 = Date.UTC(2026, 10, 13);
  const step = (status: any, at: number) => { const r = noticeDue(seen, status, at); if (r.notify) shown++; seen = r.seen; return r.notify; };
  assert.equal(step('active', t0), false, 'ordinary states never notify');
  assert.equal(step('offline', t0), false);
  assert.equal(step('sign_in_required', t0), false);
  assert.equal(step('expiring_soon', t0), true);
  for (let i = 1; i <= 200; i++) step(i % 2 ? 'connection_required' : 'expiring_soon', t0 + i * 5 * MINUTE);   // flapping for 16 hours
  assert.equal(shown, 2, 'one for each state');
  assert.equal(step('expiring_soon', t0 + DAY - 1), false);
  assert.equal(step('expiring_soon', t0 + DAY + 1), true, 'again after a day');
  assert.equal(noticeDue({ status: 'revoked', at: t0 }, 'revoked', t0 + HOUR).notify, false, 'the stored format of 1.1 is understood');
  assert.equal(noticeDue('garbage', 'revoked', t0).notify, true);
  assert.equal(noticeDue({ revoked: t0 + 10 * DAY }, 'revoked', t0).notify, true, 'a stored time in the future does not silence notices');
});

test('state changes are published once per change, not once per check', async () => {
  const { m, srv, env } = setup(free());
  await m.activate();
  m.startTimers();
  env.changes.length = 0;
  await advance(env, 6 * HOUR, srv);
  assert.ok(env.changes.every((s) => s === 'active'));
  m.dispose();
});

// ---------------------------------------------------------------------------------------------- device proof, API hooks, build hash
test('device proof: signed by the device key for this account and time; changes with the server clock', async () => {
  const { m, srv, env, secrets } = setup(free());
  await m.activate();
  const proof = (await m.proof())!;
  const [dev, ts, sig] = proof.split('.');
  const d = JSON.parse(secrets.m.get(DEVICE_KEY)!);
  assert.equal(dev, d.id);
  assert.equal(Number(ts), Math.floor(env.now / 1000));
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: d.publicKey }, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(`tcdev1.${'a'.repeat(32)}.${dev}.${ts}`), pub, fromB64u(sig)));
  assert.ok(!verify(null, Buffer.from(`tcdev1.${'b'.repeat(32)}.${dev}.${ts}`), pub, fromB64u(sig)), 'bound to the account');
  // this computer's clock is 3 hours fast: the proof still carries the server's time
  const skewed = setup(srv);
  skewed.env.now = srv.clock + 3 * HOUR;
  await skewed.m.activate();
  assert.equal(Number((await skewed.m.proof())!.split('.')[1]), Math.floor(srv.clock / 1000));
});

test('API client: reports the revocation version of signed-in responses, adds the device proof, reports 401', async () => {
  const seen: number[] = []; let unauthorised = 0; const sent: any[] = [];
  let status = 200; let rev: string | null = '7';
  const fetchImpl = async (_u: string, init: any) => { sent.push(init.headers);
    return { ok: status < 400, status, headers: { get: (n: string) => (n === 'x-trustcode-licence-rev' ? rev : n === 'content-type' ? 'application/json' : null) }, json: async () => ({}), text: async () => '' }; };
  const api = new TrustCodeApi(() => 'https://api.example', { get: async () => ({ access: 'tok' }), set: async () => undefined }, () => 1000, fetchImpl as any);
  api.hooks = { onLicenceRev: (r) => seen.push(r), onUnauthorized: () => { unauthorised++; },
    headers: async (m, p): Promise<Record<string, string>> => (m === 'POST' && p === '/verifications' ? { 'X-TrustCode-Device': 'proof' } : {}) };
  await api.request('GET', '/me');
  await api.request('POST', '/verifications', {});
  assert.deepEqual(seen, [7, 7]);
  assert.equal(sent[0]['X-TrustCode-Device'], undefined);
  assert.equal(sent[1]['X-TrustCode-Device'], 'proof');
  rev = 'not-a-number'; await api.request('GET', '/me');
  rev = null; await api.request('GET', '/me');
  assert.equal(seen.length, 2, 'malformed or missing header is ignored');
  await api.request('GET', '/plans', undefined, { auth: false });
  assert.equal(sent.at(-1)['X-TrustCode-Device'], undefined);
  status = 401;
  await assert.rejects(api.request('GET', '/me'));
  assert.equal(unauthorised, 1);
  api.hooks = { onLicenceRev: () => { throw new Error('boom'); } };
  status = 200; rev = '9';
  await api.request('GET', '/me');             // a failing hook never breaks a request
});

test('build hash: stable for the same files, different after any change, undefined when there is nothing to hash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-build-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'exports.a = 1;');
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'exports.b = 2;');
  fs.writeFileSync(path.join(dir, 'a.js.map'), 'ignored');
  const h1 = await buildHash(dir);
  assert.match(h1!, /^[a-f0-9]{64}$/);
  assert.equal(await buildHash(dir), h1);
  fs.writeFileSync(path.join(dir, 'a.js.map'), 'ignored, changed');
  assert.equal(await buildHash(dir), h1, 'only code files count');
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'exports.b = 2; /* licence check removed */');
  assert.notEqual(await buildHash(dir), h1);
  assert.equal(await buildHash(path.join(dir, 'missing')), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evaluate never widens: an unusable state has the Free plan and no features', () => {
  const p: any = { v: 1, kid: 't1', lid: 'l', sub: 's', dev: 'd', plan: { id: 'team', name: 'Team' }, state: 'active', features: { x: true }, limits: {},
    act: 0, iat: 1000, validated_at: 1000, grace_days: 30, offline_until: 1000 + 30 * 86400, paid_until: 1000 + 30 * 86400, refresh_after: 2000 };
  for (const input of [{ nowMs: 1, clockFloorMs: 0, offline: false }, { payload: p, nowMs: 0, clockFloorMs: 5e12, offline: false },
    { payload: p, nowMs: (1000 + 31 * 86400) * 1000, clockFloorMs: 0, offline: true }, { payload: p, nowMs: 2e6, clockFloorMs: 0, offline: false, revoked: { code: 'device_revoked', message: 'x' } }]) {
    const v = evaluate(input as any);
    if (!v.usable) { assert.equal(v.plan.id, 'free'); assert.deepEqual(v.features, {}); }
  }
  void server;
});
