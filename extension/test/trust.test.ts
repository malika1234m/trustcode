import * as assert from 'node:assert';
import { test } from 'node:test';
import { accountDashboard, DashboardData, privacyStatus, PrivacyInputs } from '../src/ui';
import { compareVersions, parseVersion, readRelease, tooOldForServer } from '../src/updates';

const privacy = (over: Partial<PrivacyInputs> = {}): PrivacyInputs => ({ scanner: 'ready', signedIn: true, backend: 'https://trustcode-api.vercel.app', localBackend: false,
  llmSetting: false, llmAllowedInProfile: false, llmAvailableOnServer: false, onlineAdvisories: false, updateCheck: true, entitlementVerifiedAt: 1_000_000, ...over });
const row = (rows: ReturnType<typeof privacyStatus>, label: string) => rows.find((r) => r.label === label)!;
const NOW = 1_000_000 + 5 * 60000;

test('privacy status reflects the actual settings and connection, not fixed labels', () => {
  const base = privacyStatus(privacy(), NOW);
  assert.strictEqual(row(base, 'Security scanning').value, 'Local');
  assert.strictEqual(row(base, 'External AI analysis').value, 'Off');
  assert.strictEqual(row(base, 'Telemetry and analytics').value, 'None');
  assert.match(row(base, 'Subscription verification').value, /Connected — verified 5 min ago/);
  assert.match(row(base, 'Code sent to the TrustCode server').value, /Only when you use Verify or Session, after you confirm/);
  // AI is "on" only when the setting, the profile AND the server all allow it
  assert.strictEqual(row(privacyStatus(privacy({ llmSetting: true, llmAllowedInProfile: true }), NOW), 'External AI analysis').value, 'Off');
  assert.match(row(privacyStatus(privacy({ llmSetting: true, llmAllowedInProfile: true }), NOW), 'External AI analysis').detail, /no AI provider configured/);
  assert.match(row(privacyStatus(privacy({ llmSetting: true, llmAllowedInProfile: true, llmAvailableOnServer: true }), NOW), 'External AI analysis').value, /^On:/);
  assert.match(row(privacyStatus(privacy({ scanner: 'missing' }), NOW), 'Security scanning').value, /Not available/);
  assert.match(row(privacyStatus(privacy({ signedIn: false }), NOW), 'Code sent to the TrustCode server').value, /Never \(signed out\)/);
  assert.match(row(privacyStatus(privacy({ localBackend: true, backend: 'http://127.0.0.1:8000' }), NOW), 'Code sent to the TrustCode server').value, /your own machine/);
  assert.match(row(privacyStatus(privacy({ onlineAdvisories: true }), NOW), 'Dependency advisory lookups').value, /osv\.dev/);
  assert.match(row(privacyStatus(privacy({ updateCheck: false }), NOW), 'Update check').value, /^Off/);
  assert.match(row(privacyStatus(privacy({ entitlementOffline: true }), NOW), 'Subscription verification').value, /Offline — last verified 5 min ago/);
  assert.ok(!base.some((r) => /100%|guarantee|never access any data/i.test(r.value + r.detail)));
});

const ent = (state: string, extra: any = {}) => ({ plan: { id: state === 'free' ? 'free' : 'pro', name: state === 'free' ? 'Free' : 'Pro' },
  limits: { verifications_per_month: state === 'free' ? 300 : null }, usage: { verifications_this_month: 125, remaining: state === 'free' ? 175 : null, resets_at: '2026-12-01T00:00:00+00:00' },
  subscription: { state, paid: state !== 'free', billing_live: true, reason: 'r', ...extra } });
const dash = (over: Partial<DashboardData> = {}): DashboardData => ({ entitlements: ent('free', { billing_live: false }), verifiedAt: NOW - 30_000, email: 'dev@example.com',
  update: { installed: '0.9.0', available: false }, privacy: privacy(), ...over });

test('account dashboard shows only what the server returned: plan, status, renewal, usage, last verification', () => {
  const free = accountDashboard(dash(), NOW);
  assert.match(free, /dev@example\.com[\s\S]*Plan<\/dt><dd>Free[\s\S]*Free plan[\s\S]*just now/);
  assert.match(free, /125 of 300[\s\S]*Remaining<\/dt><dd>175/);
  assert.match(free, /Paid plans are not on sale yet/);
  assert.match(free, /Local security scans<\/dt><dd>Not limited, not counted/);
  const active = accountDashboard(dash({ entitlements: ent('active', { current_period_end: '2026-12-12T00:00:00+00:00' }) }), NOW);
  assert.match(active, /Plan<\/dt><dd>Pro[\s\S]*Active[\s\S]*Next renewal<\/dt><dd>[^<]*December[^<]*2026/);
  assert.match(active, /125 \(no limit\)/);
  const failed = accountDashboard(dash({ entitlements: ent('payment_failed', { grace_until: '2026-11-20T00:00:00+00:00', current_period_end: '2026-11-12T00:00:00+00:00' }) }), NOW);
  assert.match(failed, /Payment failed \(grace period\)[\s\S]*Grace period ends/);
  assert.match(accountDashboard(dash({ entitlements: ent('cancelled', { cancel_at_period_end: true, current_period_end: '2026-12-12T00:00:00+00:00' }) }), NOW), /Paid until/);
  assert.match(accountDashboard(dash({ offline: true, verifiedAt: NOW - 3 * 3600000 }), NOW), /180 min ago[\s\S]*offline — showing the last verified state/);
  const unknown = accountDashboard(dash({ entitlements: undefined }), NOW);
  assert.match(unknown, /could not be verified[\s\S]*Server-side limits still apply/);
  assert.ok(!/Pro<\/dd>|Active/.test(unknown), 'no plan may be shown when nothing was verified');
  assert.ok(!accountDashboard(dash({ email: '<img src=x>' }), NOW).includes('<img src=x>'));
});

test('updates: versions compare numerically, releases are validated, and only this project\'s links are accepted', () => {
  assert.deepStrictEqual(parseVersion('v0.10.2'), [0, 10, 2]);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0 && compareVersions('v1.0.0', '1.0.0') === 0 && compareVersions('0.8.0', '0.9.0') < 0);
  assert.strictEqual(compareVersions('latest', '0.9.0'), 0, 'an unparseable version is never treated as newer');
  const rel = (over: any = {}) => ({ tag_name: 'v0.10.0', html_url: 'https://github.com/malika1234m/trustcode/releases/tag/v0.10.0', body: 'notes',
    assets: [{ name: 'trustcode-0.10.0.vsix', browser_download_url: 'https://github.com/malika1234m/trustcode/releases/download/v0.10.0/trustcode-0.10.0.vsix' },
      { name: 'trustcode-0.10.0.vsix.sha256', browser_download_url: 'https://github.com/malika1234m/trustcode/releases/download/v0.10.0/trustcode-0.10.0.vsix.sha256' }], ...over });
  const up = readRelease('0.9.0', rel(), 5);
  assert.deepStrictEqual([up.available, up.latest, !!up.vsixUrl, !!up.sha256Url, up.notes], [true, '0.10.0', true, true, 'notes']);
  assert.strictEqual(readRelease('0.10.0', rel(), 5).available, false, 'the latest version is already installed');
  assert.strictEqual(readRelease('0.11.0', rel(), 5).available, false, 'an older release is never offered (no downgrade)');
  const evil = readRelease('0.9.0', rel({ html_url: 'https://evil.example/x', assets: [{ name: 'trustcode-0.10.0.vsix', browser_download_url: 'https://evil.example/trustcode-0.10.0.vsix' }] }), 5);
  assert.deepStrictEqual([evil.pageUrl, evil.vsixUrl, evil.sha256Url], [undefined, undefined, undefined]);
  assert.strictEqual(readRelease('0.9.0', rel({ assets: [rel().assets[0]] }), 5).sha256Url, undefined, 'no checksum published: nothing can be auto-installed');
  for (const bad of [{}, null, { tag_name: 'nightly' }, rel({ prerelease: true }), rel({ draft: true })]) assert.strictEqual(readRelease('0.9.0', bad, 5).available, false);
  assert.ok(tooOldForServer('0.3.0', '0.4.0') && !tooOldForServer('0.9.0', '0.4.0') && !tooOldForServer('0.9.0', undefined));
  const html = accountDashboard(dash({ update: { installed: '0.9.0', latest: '0.10.0', available: true, notes: '<b>n</b>', canInstall: true } }), NOW);
  assert.match(html, /Update available[\s\S]*data-action="installUpdate"[\s\S]*data-action="openRelease"/);
  assert.ok(!html.includes('<b>n</b>'));
  assert.ok(!accountDashboard(dash({ update: { installed: '0.9.0', latest: '0.10.0', available: true, canInstall: false } }), NOW).includes('data-action="installUpdate"'));
  assert.match(accountDashboard(dash({ update: { installed: '0.9.0', available: false, error: 'The release list could not be reached.' } }), NOW), /could not be reached/);
  assert.match(accountDashboard(dash({ update: { installed: '0.3.0', available: false, tooOld: true } }), NOW), /older than the server still supports/);
});
