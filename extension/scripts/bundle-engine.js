// Builds the engine wheel that ships inside the extension (engine/*.whl) from ../verification-worker.
// The wheel contains only the engine's own code and rules; its dependencies are downloaded from PyPI when
// the user agrees to set the engine up.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'engine');
const src = path.resolve(root, '..', 'verification-worker');
const candidates = [process.env.TRUSTCODE_BUILD_PYTHON, path.resolve(root, '..', '.venv', 'bin', 'python'), path.resolve(root, '..', '.venv', 'Scripts', 'python.exe'), 'python3', 'python'].filter(Boolean);
const python = candidates.find((p) => { try { execFileSync(p, ['-c', 'import pip'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!python) { console.error('bundle-engine: no Python with pip found (set TRUSTCODE_BUILD_PYTHON)'); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync(python, ['-m', 'pip', 'wheel', '--no-deps', '--quiet', '--wheel-dir', out, src], { stdio: 'inherit' });
const wheels = fs.readdirSync(out).filter((f) => /^trustcode_worker-[\w.]+-py3-none-any\.whl$/.test(f));
if (wheels.length !== 1) { console.error(`bundle-engine: expected one engine wheel, found ${wheels.length}`); process.exit(1); }
console.log(`bundle-engine: ${wheels[0]} (${Math.round(fs.statSync(path.join(out, wheels[0])).size / 1024)} KB)`);
