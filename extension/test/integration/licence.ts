// The account gate inside a real VS Code window, signed out (a fresh profile: no account, no licence).
// Nothing may run in the background: not the startup scan, not a session started by an agent signal, not the file
// watcher of a restored session. Only the sign-in screen and the open commands work.
//
// Signing in and activating cannot be exercised here: the extension only accepts licences signed with the pinned
// production key, which a test server does not have. Those flows are covered by test/licence*.test.ts with a fake
// server; here an account being confirmed or lost is simulated through the same call the extension makes
// (SessionController.setLicensed).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type R = { name: string; ok: boolean; ms: number; err?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLicenceScenarios(hook: any): Promise<R[]> {
  const results: R[] = [];
  const t = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e: any) { results.push({ name, ok: false, ms: Date.now() - t0, err: e?.message }); console.log(`  FAIL ${name}: ${e?.message}`); }
  };
  const { view, security } = hook;
  let session = hook.session;
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const write = (rel: string, text: string) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const until = async (cond: () => boolean, what: string, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(100); } };
  const tracked = (): string[] => (session.model().session?.changes ?? []).map((c: { path: string }) => c.path);
  const active = () => { const s = session.model().session; return !!s && s.status !== 'ended'; };
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const set = (k: string, v: unknown) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
  await set('backendUrl', 'http://127.0.0.1:9');                 // nothing listens here: no request can succeed
  await set('scanner.scanOnStartup', true); await set('session.autoStartOnAgentSignal', true);
  await set('session.notifications', 'none'); await set('session.inactivitySeconds', 0);

  await t('first start with no account: no licence, TrustCode is not usable', async () => {
    await until(() => view.licence.view.status !== undefined, 'the licence to load');
    assert.strictEqual(view.licence.usable(), false);
    assert.strictEqual(view.licence.view.status, 'sign_in_required');
    assert.strictEqual(await view.refreshAuth(), false);
    assert.strictEqual(view.licence.allows('llm_explanations'), false);
    assert.strictEqual(await view.licence.proof(), undefined, 'no device proof without a licence');
  });

  await t('every feature command is blocked and shows the sign-in screen instead', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'app', 'auth.py')));
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(0, 0, 2, 0);
    const before = doc.getText();
    for (const c of ['trustcode.verifySelection', 'trustcode.verifyFile', 'trustcode.verify', 'trustcode.startSession', 'trustcode.reviewLatestChanges', 'trustcode.verifySessionChanges',
      'trustcode.verifyGitChanges', 'trustcode.verifyWorkspace', 'trustcode.scanProject', 'trustcode.scanChangedFiles', 'trustcode.scanBeforeCommit', 'trustcode.rescanSecurity',
      'trustcode.setSecurityBaseline', 'trustcode.installGitHooks', 'trustcode.setupEngine']) {
      await vscode.commands.executeCommand(c);
      assert.strictEqual(active(), false, `${c} started a session`);
      assert.ok(!security.model().scanning && !security.model().report, `${c} started a scan`);
      assert.ok(!view.jobId, `${c} started a verification`);
    }
    assert.strictEqual(doc.getText(), before);
    assert.ok(!fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit')), 'a Git hook was installed without an account');
    assert.strictEqual(view.signedIn, false);
  });

  await t('the open commands still work signed out (account, licence check, engine status)', async () => {
    for (const c of ['trustcode.showAccount', 'trustcode.checkLicence', 'trustcode.clearFindings', 'trustcode.forgetConsent']) await vscode.commands.executeCommand(c);
    assert.strictEqual(view.licence.usable(), false, 'checking the licence without an account must not make it usable');
  });

  await t('the startup scan does not run', async () => {
    security.startup();                                           // what the extension calls when a window opens
    await sleep(5500);                                            // the scan would begin after 4 s
    assert.ok(!security.model().scanning && !security.model().report, 'a scan ran without an account');
    assert.strictEqual(await security.scan('full', { quiet: true }), undefined);
  });

  await t('an agent signal does not start a session, and a session cannot be started directly', async () => {
    write('.trustcode/agent-signal.json', JSON.stringify({ event: 'start', agent: 'test-agent' }));
    await sleep(2000);
    assert.strictEqual(active(), false, 'the agent signal started a session');
    assert.strictEqual(await session.start('Test agent'), false);
    assert.strictEqual(session.watching(), false);
  });

  await t('a session restored after a restart is not watched until the account is confirmed', async () => {
    // set-up only: a session that was being tracked while the account was still confirmed
    session.gate = () => true;
    assert.ok(await session.start('Test agent'), 'set-up: the session did not start');
    write('app/during.py', 'x = 1\n');
    await until(() => tracked().includes('app/during.py'), 'the change made while signed in');
    // VS Code restarts and the account is no longer confirmed (signed out, removed, or the offline period ended)
    session = await hook.restartSession();
    assert.strictEqual(view.licence.usable(), false);
    assert.ok(active(), 'the session itself is kept');
    assert.strictEqual(session.watching(), false, 'the file watcher was attached without an account');
    write('app/while_signed_out.py', 'y = 2\n');
    await sleep(2500);
    assert.ok(!tracked().includes('app/while_signed_out.py'), 'a file was read and tracked without an account');
    await session.verify('session', 'manual', false);
    assert.ok(!session.latestRun(), 'a verification ran without an account');
    // the account is confirmed again: tracking resumes and catches up
    session.setLicensed(true);
    assert.strictEqual(session.watching(), true);
    await until(() => tracked().includes('app/while_signed_out.py'), 'the change to be picked up after the account was confirmed');
    // and lost again while the window is open (device removed, account suspended): the watcher is detached at once
    session.setLicensed(false);
    assert.strictEqual(session.watching(), false);
    write('app/after_removal.py', 'z = 3\n');
    await sleep(2500);
    assert.ok(!tracked().includes('app/after_removal.py'), 'a file was tracked after the account was lost');
  });

  console.log(`  activation: ${hook.activationMs} ms (the licence is loaded in the background; activation does not wait for it)`);
  return results;
}
