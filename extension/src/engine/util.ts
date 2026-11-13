// Pure helpers for the local engine (no vscode import -> unit-testable).
import * as path from 'path';

export const MIN_PYTHON: [number, number] = [3, 11];
/** Installed one by one after the engine itself, so one tool that cannot be installed does not block the rest. */
export const TOOL_PACKAGES = ['ruff>=0.6', 'pyflakes>=3.2', 'mypy>=1.11', 'bandit>=1.7', 'semgrep>=1.70'];

export function parsePythonVersion(out: string): [number, number] | undefined {
  const m = /^(\d+)\.(\d+)\s*$/.exec(out.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}
export const pythonOk = (v: [number, number] | undefined) => !!v && (v[0] > MIN_PYTHON[0] || (v[0] === MIN_PYTHON[0] && v[1] >= MIN_PYTHON[1]));
export function venvPaths(dir: string, platform: string = process.platform) {
  const bin = path.join(dir, platform === 'win32' ? 'Scripts' : 'bin');
  const exe = platform === 'win32' ? '.exe' : '';
  return { bin, python: path.join(bin, `python${exe}`), scanner: path.join(bin, `trustcode-scan${exe}`) };
}
/** The last JSON line of the engine's output (tools may not print there, but a stray line must not break parsing). */
export function parseAnswer(stdout: string): any | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    if (!line.startsWith('{')) continue;
    try { const v = JSON.parse(line); if (v && typeof v.ok === 'boolean') return v; } catch { /* keep looking */ }
  }
  return undefined;
}
