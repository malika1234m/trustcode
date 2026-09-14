// Runs the extension inside a real VS Code instance (extension host) and executes suite.ts.
// Set VSCODE_EXECUTABLE to the VS Code binary (e.g. ".../Visual Studio Code.app/Contents/MacOS/Code").
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './suite');
  await runTests({ vscodeExecutablePath: process.env.VSCODE_EXECUTABLE, extensionDevelopmentPath, extensionTestsPath,
    launchArgs: ['--disable-extensions', '--user-data-dir', path.join(os.tmpdir(), 'trustcode-vscode-test')] });
}
main().catch((e) => { console.error('Integration tests failed:', e); process.exit(1); });
