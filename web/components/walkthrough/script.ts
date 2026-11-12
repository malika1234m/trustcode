// Storyboard for the homepage walkthrough: a 78-second, seven-scene product film rendered as live UI.
// Everything here is demonstration data. The behaviour it depicts follows the real product (extension 0.9.0 and the
// local scanner, see docs/security_scanner.md): the rule IDs, severities, confidence levels, scanners, policy
// defaults and the "not checked" list are taken from the code. The files, findings and numbers are invented.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Camera = { s: number; x: number; y: number };   // scale, and the stage point (px) to centre on

export type Scene = {
  id: string; chapter: string; title: string; caption: string; start: number; duration: number; camera: Camera;
};

/** Logical stage size. The stage is drawn at this size and scaled to fit, like a video frame. */
export const STAGE = { w: 1120, h: 630 } as const;

const WIDE: Camera = { s: 1, x: 560, y: 315 };
const raw: Omit<Scene, 'start'>[] = [
  { id: 'edits', chapter: 'AI edits', title: 'The agent starts working', duration: 10,
    caption: 'Your AI coding agent starts modifying your project.', camera: { s: 1.22, x: 470, y: 400 } },
  { id: 'detected', chapter: 'Changes detected', title: 'Every change is noticed', duration: 10,
    caption: 'TrustCode notices every created and modified file, whichever agent or tool made the change.', camera: { s: 1.3, x: 300, y: 300 } },
  { id: 'scanned', chapter: 'Project scanned', title: 'The local scan runs', duration: 11,
    caption: 'Once the edits settle, the changed files are scanned on your machine by every available engine.', camera: { s: 1.28, x: 900, y: 300 } },
  { id: 'risks', chapter: 'Risks identified', title: 'Risks are flagged', duration: 13,
    caption: 'Findings appear at the exact file and line, each with a severity and a separate confidence.', camera: { s: 1.12, x: 740, y: 330 } },
  { id: 'evidence', chapter: 'Evidence reviewed', title: 'Review the evidence', duration: 13,
    caption: 'Every finding shows the rule, the evidence that triggered it, and what the scan could not check.', camera: { s: 1.16, x: 640, y: 300 } },
  { id: 'release', chapter: 'Ready for release', title: 'Gates before Git and production', duration: 12,
    caption: 'Git hooks and CI apply your policy before vulnerable changes reach production.', camera: WIDE },
  { id: 'finish', chapter: 'Ship with confidence', title: 'Know what was checked', duration: 9,
    caption: 'Know what changed. Know what was checked. Ship with confidence.', camera: WIDE },
];

export const SCENES: Scene[] = raw.reduce<Scene[]>((acc, s) => {
  const prev = acc[acc.length - 1];
  acc.push({ ...s, start: prev ? prev.start + prev.duration : 0 });
  return acc;
}, []);
export const TOTAL = SCENES[SCENES.length - 1].start + SCENES[SCENES.length - 1].duration;

export function sceneAt(t: number) {
  let i = SCENES.length - 1;
  while (i > 0 && t < SCENES[i].start) i--;
  return i;
}

// ---- Project -----------------------------------------------------------------------------------------------

export type Change = 'A' | 'M';
export type TreeNode = { path: string; name: string; depth: number; dir?: boolean; change?: Change; at?: number };

/** Explorer rows. `at` = seconds into the "detected" scene when the change badge appears. */
export const TREE: TreeNode[] = [
  { path: 'backend', name: 'backend', depth: 0, dir: true },
  { path: 'backend/db.py', name: 'db.py', depth: 1 },
  { path: 'backend/users.py', name: 'users.py', depth: 1, change: 'M', at: 0.6 },
  { path: 'config', name: 'config', depth: 0, dir: true },
  { path: 'config/.env.production', name: '.env.production', depth: 1, change: 'A', at: 2.6 },
  { path: 'config/settings.json', name: 'settings.json', depth: 1, change: 'M', at: 3.6 },
  { path: 'frontend', name: 'frontend', depth: 0, dir: true },
  { path: 'frontend/app.tsx', name: 'app.tsx', depth: 1 },
  { path: 'src', name: 'src', depth: 0, dir: true },
  { path: 'src/api.ts', name: 'api.ts', depth: 1, change: 'A', at: 1.6 },
  { path: 'src/index.ts', name: 'index.ts', depth: 1 },
  { path: 'tests', name: 'tests', depth: 0, dir: true },
  { path: 'tests/test_users.py', name: 'test_users.py', depth: 1, change: 'M', at: 4.6 },
  { path: '.env.example', name: '.env.example', depth: 0 },
  { path: '.gitignore', name: '.gitignore', depth: 0 },
  { path: 'package.json', name: 'package.json', depth: 0, change: 'M', at: 5.4 },
];
export const CHANGED = TREE.filter((n) => n.change);

/** What the agent says it is doing (scene 1). */
export const AGENT_LOG: { at: number; text: string }[] = [
  { at: 0.6, text: 'Updating user search in backend/users.py' },
  { at: 2.4, text: 'Creating src/api.ts' },
  { at: 4.4, text: 'Adding STRIPE_SECRET_KEY to config/.env.production' },
  { at: 6.4, text: 'Skipping a flaky test in tests/test_users.py' },
];

/** File contents shown in the editor. `start` is the first line number. */
export const FILES: Record<string, { start: number; lines: string[]; lang: string }> = {
  'backend/users.py': { start: 36, lang: 'Python', lines: [
    'from flask import request, jsonify', 'from .db import db', '', '@app.get("/users")', 'def find_user():',
    '    name = request.args["name"]', '    rows = db.execute(f"SELECT * FROM users WHERE name=\'{name}\'")', '    return jsonify(rows.fetchall())'] },
  'src/api.ts': { start: 80, lang: 'TypeScript', lines: [
    "router.get('/search', async (req, res) => {", "  const q = String(req.query.q ?? '');", '  const results = await search(q);', '',
    '  // render the results page', '', '  res.send(`<h1>Results for ${q}</h1>${list(results)}`);', '});'] },
  'config/.env.production': { start: 1, lang: 'Env', lines: [
    'NODE_ENV=production', 'DATABASE_URL=postgres://db.internal:5432/app', 'STRIPE_SECRET_KEY=sk_live_51Hx…[redacted]', 'LOG_LEVEL=info'] },
  'tests/test_users.py': { start: 8, lang: 'Python', lines: [
    'from backend.users import find_user', '', '', '@pytest.mark.skip(reason="flaky")', 'def test_find_user_rejects_injection(client):',
    '    r = client.get("/users?name=\' OR 1=1 --")', '    assert r.json == []'] },
  'config/settings.json': { start: 1, lang: 'JSON', lines: ['{', '  "search": { "pageSize": 20 },', '  "features": { "newSearch": true }', '}'] },
  'package.json': { start: 1, lang: 'JSON', lines: ['{', '  "name": "acme-shop",', '  "dependencies": {', '    "express": "^4.21.2",', '    "zod": "^3.23.8"', '  }', '}'] },
};

// ---- Findings ----------------------------------------------------------------------------------------------

export type Finding = {
  id: string; severity: Severity; confidence: 'Strongly suspected' | 'Potential' | 'Confirmed'; title: string; rule: string;
  path: string; line: number; evidence: string; reason: string; fix: string; gate: string; at: number;
};

/** `at` = seconds into the "risks" scene when the finding appears. Rule IDs and policies are the real ones. */
export const FINDINGS: Finding[] = [
  { id: 'sec', severity: 'critical', confidence: 'Strongly suspected', title: 'Provider credential in file', rule: 'TC-SEC-001',
    path: 'config/.env.production', line: 3, evidence: 'STRIPE_SECRET_KEY=sk_live_51Hx…[redacted]',
    reason: 'A value in the format of a live Stripe secret key.', fix: 'Rotate the key, remove it and load it from a secret store.',
    gate: 'Blocks a commit (default policy: critical)', at: 1.2 },
  { id: 'sql', severity: 'high', confidence: 'Strongly suspected', title: 'SQL injection', rule: 'sql-string-formatting',
    path: 'backend/users.py', line: 42, evidence: 'db.execute(f"SELECT * FROM users WHERE name=\'{name}\'")',
    reason: 'Request data is formatted into SQL text.', fix: 'Use a parameterised query.', gate: 'Blocks in CI (default policy: high)', at: 3.4 },
  { id: 'xss', severity: 'high', confidence: 'Strongly suspected', title: 'Request data in HTML output', rule: 'js-taint-xss',
    path: 'src/api.ts', line: 86, evidence: 'res.send(`<h1>Results for ${q}</h1>…`)',
    reason: 'req.query.q reaches res.send() without escaping.', fix: 'Escape the value or render it through a template.', gate: 'Warns (rule policy)', at: 5.4 },
  { id: 'reg', severity: 'medium', confidence: 'Strongly suspected', title: 'Test disabled or deleted', rule: 'TC-REG-003',
    path: 'tests/test_users.py', line: 11, evidence: '@pytest.mark.skip(reason="flaky")',
    reason: 'This change skips a test that ran in the last commit.', fix: 'Fix the test instead of skipping it.', gate: 'Warns', at: 7.4 },
];

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

// ---- Scanners (scene 3) ------------------------------------------------------------------------------------

export type Engine = { name: string; role: string; state: 'ran' | 'missing' | 'off'; note: string; detail: string };
export const ENGINES: Engine[] = [
  { name: 'Semgrep', role: 'Code rules and data flow', state: 'ran', note: '4 files', detail: 'Pattern and intra-file data-flow rules for Python, JavaScript, TypeScript, PHP and Java.' },
  { name: 'Built-in rules', role: 'Credentials, env, config', state: 'ran', note: '6 files', detail: 'Credential formats, environment files, agent, CI and container configuration.' },
  { name: 'Gitleaks', role: 'Second credential detector', state: 'ran', note: 'optional', detail: 'Runs when installed. Its findings are merged with the built-in credential rules.' },
  { name: 'Weakened controls', role: 'Compared with last commit', state: 'ran', note: 'git diff', detail: 'Removed auth guards, skipped or deleted tests, removed ignore rules, weakened CI steps.' },
  { name: 'Bandit', role: 'Extra Python rules', state: 'missing', note: 'not installed', detail: 'Optional. The report says it did not run, instead of staying silent.' },
  { name: 'OSV advisories', role: 'Vulnerable dependencies', state: 'off', note: 'off · opt-in', detail: 'Opt-in because it sends package names and versions to the OSV service.' },
];

export const NOT_CHECKED = ['Authorization of routes', 'Rate limiting', 'Missing input validation', 'Runtime behaviour'];

// ---- Pipeline (scene 6) ------------------------------------------------------------------------------------

export type Stage = { name: string; note: string; detail: string; at: number; blocked?: boolean };
export const PIPELINE: Stage[] = [
  { name: 'Code changes', note: 'Tracked', at: 0.4, detail: 'Created, modified and deleted files are noticed, whichever tool made them.' },
  { name: 'Security scan', note: 'Local', at: 1.4, detail: 'Runs on your machine. Unchanged files come from the cache.' },
  { name: 'Review', note: 'Evidence', at: 2.4, detail: 'Findings at the exact range. Mark reviewed false positives with a reason.' },
  { name: 'Git', note: 'Pre-commit hook', at: 3.4, blocked: true, detail: 'Scans the staged content. Default policy blocks critical findings; an existing hook is never replaced.' },
  { name: 'CI/CD', note: 'SARIF', at: 6.6, detail: 'CI mode scans the full project and blocks high findings by default. An incomplete scan blocks.' },
  { name: 'Production', note: 'Production scan', at: 7.6, detail: 'Full scan with the cache ignored; existing findings also count.' },
];
export const COMMIT_LOG: { at: number; text: string; tone?: 'err' | 'ok' | 'dim' }[] = [
  { at: 3.6, text: '$ git commit -m "Add user search"' },
  { at: 4.4, text: 'TrustCode pre-commit · scanning staged files', tone: 'dim' },
  { at: 5.2, text: '✖ Blocked by policy: 1 critical finding', tone: 'err' },
  { at: 5.6, text: '  TC-SEC-001  config/.env.production:3', tone: 'err' },
];
