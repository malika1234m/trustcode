// Measures how long an online device keeps working after it is revoked, with an injected clock (simulated time).
// Runs the same scenario against the current licence manager and, when OLD_MANAGER points at a compiled manager.js
// of an earlier release, against that one too. Not a test file: run with `node out/test/measure-revocation.js`.
import { LicenceManager } from '../src/licence/manager';
import { advance, FakeServer, HOUR, MINUTE, setup } from './licence-fake';

async function measure(label: string, Manager: any) {
  const rows: string[] = [];
  for (const [what, apply] of [['device revoked', (s: FakeServer) => { s.refusal = 'device_revoked'; }], ['account suspended', (s: FakeServer) => { s.refusal = 'account_suspended'; }],
    ['account deleted', (s: FakeServer) => { s.devices.clear(); }]] as const) {
    const srv = new FakeServer(); srv.plan = { id: 'free', name: 'Free' };
    const { env, mk } = setup(srv);
    const m = mk(Manager);
    await m.activate();
    m.startTimers();
    await advance(env, 5 * HOUR, srv);
    // worst case: the change happens just after the device last heard from the server
    const n = srv.calls.length;
    await advance(env, 48 * HOUR, srv, () => srv.calls.length > n);
    const t0 = env.now, calls = srv.calls.length;
    apply(srv);
    await advance(env, 72 * HOUR, srv, () => !m.view.usable);
    rows.push(`${label} | ${what} | ${m.view.usable ? 'still working after 72 h' : `${((env.now - t0) / MINUTE).toFixed(0)} min (${((env.now - t0) / HOUR).toFixed(1)} h)`} | ${srv.calls.length - calls} request(s) until it stopped`);
    m.dispose();
  }
  return rows;
}

(async () => {
  const out: string[] = [];
  if (process.env.OLD_MANAGER) out.push(...await measure('before (1.1.1)', require(process.env.OLD_MANAGER).LicenceManager));
  out.push(...await measure('after', LicenceManager));
  console.log(out.join('\n'));
})();
