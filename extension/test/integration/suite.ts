import * as assert from 'assert';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const failures: string[] = [];
  const t = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log(`  ok   ${name}`); } catch (e: any) { failures.push(name); console.log(`  FAIL ${name}: ${e?.message}`); }
  };
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'trustcode');
  await t('extension is present and activates', async () => {
    assert.ok(ext, 'extension not found');
    await ext!.activate();
    assert.ok(ext!.isActive);
  });
  await t('all contributed commands are registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['trustcode.verifySelection', 'trustcode.signIn', 'trustcode.signOut', 'trustcode.setExperienceLevel',
                     'trustcode.privacySettings', 'trustcode.startExperiment', 'trustcode.forgetConsent']) {
      assert.ok(cmds.includes(c), `missing ${c}`);
    }
  });
  await t('verify without a selection does not modify the document', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'python', content: 'def f():\n    return 1\n' });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('trustcode.verifySelection');
    assert.strictEqual(doc.getText(), 'def f():\n    return 1\n');
  });
  await t('verify with a selection opens the panel and leaves the document unchanged', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'python', content: 'def g():\n    return 2\n' });
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(0, 0, 1, 12);
    await vscode.commands.executeCommand('trustcode.verifySelection');
    assert.strictEqual(doc.getText(), 'def g():\n    return 2\n');
  });
  await t('default settings are privacy-preserving', async () => {
    const cfg = vscode.workspace.getConfiguration('trustcode');
    assert.strictEqual(cfg.get('useLlmExplanations'), false);
    assert.strictEqual(cfg.get('mode'), 'local');
  });
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed: ${failures.join(', ')}`);
}
