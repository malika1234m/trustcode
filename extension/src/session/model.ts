// AI coding session model (pure: no vscode import -> unit-testable).
//
// A session is defined by a BASELINE: the content hash of every tracked file at the moment tracking starts.
// A file is "changed in the session" exactly when its current content differs from that baseline. This makes
// attribution independent of how the change was made (agent CLI, editor, git checkout) and of which events
// were observed: a full rescan always reproduces the same answer, and edits that already existed before the
// session started are part of the baseline, so they are never attributed to it.

export type ChangeKind = 'created' | 'modified' | 'deleted' | 'renamed';
export type Category = 'source' | 'test' | 'config' | 'dependency' | 'migration' | 'docs' | 'other';
export type SessionStatus = 'tracking' | 'paused' | 'awaiting_review' | 'ended';

/** `hash` is a content hash, or `meta:<size>:<mtime>` for files too large to hash (tracked, never sent). */
export interface FileState { hash: string; size: number; mtime: number }
export interface ChangeRecord {
  path: string; kind: 'created' | 'modified' | 'deleted'; category: Category;
  current?: FileState; firstSeen: number; lastSeen: number;
  verifiedHash?: string;      // content hash (or "deleted") covered by the last completed verification
  editedInEditor?: boolean;   // typed in a VS Code editor during the session (you or an in-editor assistant)
  mixed?: boolean;            // also changed while tracking was paused: cannot be separated from session changes
}
/** How we know the agent may be done. Only `agent_signal` is a confirmation; inactivity is an estimate. */
export interface Completion { kind: 'agent_signal' | 'inactivity_estimate' | 'manual'; at: number; detail: string }
export interface Skipped { path: string; reason: string }
export interface GitInfo { root: string; head?: string; branch?: string; dirtyAtStart: string[] }

export interface SessionData {
  version: 1; id: string; agent: string; startedAt: number; endedAt?: number; status: SessionStatus;
  completion?: Completion;
  baseline: Record<string, FileState>;      // path -> state at session start (absent = file did not exist)
  baselineContent: Record<string, 'snapshot' | 'git' | 'none'>;  // where the pre-session text can be read from
  changes: Record<string, ChangeRecord>;
  skipped: Skipped[];                        // files deliberately not tracked, with the reason (never silent)
  git?: GitInfo;
  lastChangeAt?: number; pausedAt?: number; recoveredAt?: number;
  warnings: string[];
}

export interface TrackingRules {
  exclude: string[]; include: string[]; extensions: string[]; sensitive: string[]; maxFileSizeBytes: number;
}

export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/.trustcode/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**',
  '**/dist/**', '**/build/**', '**/out/**', '**/.next/**', '**/coverage/**', '**/.vscode-test/**', '**/*.min.js', '**/*.map', '**/.DS_Store'];
export const DEFAULT_SENSITIVE = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/id_rsa*', '**/id_ed25519*',
  '**/credentials', '**/credentials.*', '**/secrets.*', '**/*.keystore'];

const globCache = new Map<string, RegExp>();
/** Minimal glob: `**` any directories, `*` any characters except `/`, `?` one character. Matches the whole path. */
export function globToRegExp(glob: string): RegExp {
  let re = globCache.get(glob);
  if (re) return re;
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; src += '(?:.*/)?'; } else src += '.*';
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp(`^${src}$`);
  globCache.set(glob, re);
  return re;
}
export const matchesAny = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path) || (!g.includes('/') && globToRegExp(`**/${g}`).test(path)));

/** Whether a path is tracked. A path that is not tracked always comes with the reason. */
export function trackingDecision(path: string, rules: TrackingRules): { track: boolean; reason?: string } {
  if (matchesAny(path, rules.exclude)) return { track: false, reason: 'excluded by trustcode.session.exclude' };
  if (rules.include.length && !matchesAny(path, rules.include)) return { track: false, reason: 'outside trustcode.session.include' };
  if (rules.extensions.length) {
    const ext = /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? '';
    if (!rules.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase()).includes(ext)) return { track: false, reason: 'file extension not in trustcode.session.extensions' };
  }
  return { track: true };
}
export const isSensitive = (path: string, rules: TrackingRules) => matchesAny(path, rules.sensitive);

export function categorize(path: string): Category {
  const p = path.toLowerCase();
  const base = p.split('/').pop() ?? p;
  if (/^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?|setup\.(py|cfg)|uv\.lock|go\.(mod|sum)|cargo\.(toml|lock)|gemfile(\.lock)?|composer\.(json|lock))$/.test(base)) return 'dependency';
  if (/(^|\/)(migrations?|alembic|prisma\/migrations)\//.test(p) || /\.sql$/.test(base) || /^schema\.(prisma|sql|graphql|rb)$/.test(base)) return 'migration';
  if (/(^|\/)(tests?|__tests__|spec|e2e)\//.test(p) || /(^test_.*\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$|^conftest\.py$)/.test(base)) return 'test';
  if (/\.(md|mdx|rst|adoc|txt)$/.test(base) || /(^|\/)docs?\//.test(p)) return 'docs';
  if (/\.(json|ya?ml|toml|ini|cfg|conf|env|properties|xml)$/.test(base) || /^(dockerfile|makefile|\.[a-z].*rc|.*\.config\.[cm]?[jt]s|docker-compose.*)$/.test(base) || p.startsWith('.github/')) return 'config';
  if (/\.(py|[cm]?[jt]sx?|go|rs|java|kt|rb|php|cs|c|h|cpp|hpp|swift|vue|svelte|html|css|scss|sh)$/.test(base)) return 'source';
  return 'other';
}

export function newSession(id: string, agent: string, now: number): SessionData {
  return { version: 1, id, agent, startedAt: now, status: 'tracking', baseline: {}, baselineContent: {}, changes: {}, skipped: [], warnings: [] };
}

const same = (a?: FileState, b?: FileState) => !!a && !!b && a.hash === b.hash;

/**
 * Records what a path looks like now (`undefined` = it does not exist) and derives its change record from
 * the baseline. Returns true when the set of session changes changed. Idempotent: repeated and duplicate
 * observations (watcher + save + rescan for the same write) are no-ops.
 */
export function observe(s: SessionData, path: string, current: FileState | undefined, now: number): boolean {
  const base = s.baseline[path];
  const prev = s.changes[path];
  let kind: ChangeRecord['kind'] | undefined;
  if (!base && current) kind = 'created';
  else if (base && !current) kind = 'deleted';
  else if (base && current && !same(base, current)) kind = 'modified';
  if (!kind) {
    if (!prev) return false;
    delete s.changes[path];  // content is back to the baseline (e.g. the edit was undone): no longer a session change
    s.lastChangeAt = now;
    return true;
  }
  if (prev && prev.kind === kind && (kind === 'deleted' || same(prev.current, current))) return false;
  s.changes[path] = { ...(prev ?? { path, category: categorize(path), firstSeen: now }), path, kind, category: categorize(path),
    current, firstSeen: prev?.firstSeen ?? now, lastSeen: now };
  s.lastChangeAt = now;
  return true;
}

/**
 * Makes a change that happened while tracking was paused part of the baseline, so it is not attributed to
 * the session. A file that already had session changes before the pause cannot be separated: it stays a
 * session change and is flagged `mixed`.
 */
export function absorbPausedChange(s: SessionData, path: string, current: FileState | undefined): 'absorbed' | 'mixed' | 'unchanged' {
  const prev = s.changes[path];
  const before = prev ? prev.current : s.baseline[path];
  const unchanged = (!before && !current) || same(before, current) || (prev?.kind === 'deleted' && !current);
  if (unchanged) return 'unchanged';
  if (prev) {
    observe(s, path, current, Date.now());
    if (s.changes[path]) s.changes[path].mixed = true;
    return 'mixed';
  }
  if (current) s.baseline[path] = current; else delete s.baseline[path];
  s.baselineContent[path] = 'none';  // the pre-pause text is no longer the comparison point
  return 'absorbed';
}

export interface EffectiveChange extends Omit<ChangeRecord, 'kind'> { kind: ChangeKind; from?: string }

/**
 * The session's changes with renames/moves inferred: a deleted file and a created file with identical
 * content are one rename, however it was performed (editor, agent, `git mv`, shell).
 */
export function effectiveChanges(s: SessionData): EffectiveChange[] {
  const deletedByHash = new Map<string, string[]>();
  for (const c of Object.values(s.changes)) {
    if (c.kind !== 'deleted') continue;
    const h = s.baseline[c.path]?.hash;
    if (h && !h.startsWith('meta:')) deletedByHash.set(h, [...(deletedByHash.get(h) ?? []), c.path]);
  }
  const renamedFrom = new Set<string>();
  const out: EffectiveChange[] = [];
  for (const c of Object.values(s.changes).sort((a, b) => a.path.localeCompare(b.path))) {
    if (c.kind === 'created' && c.current) {
      const from = deletedByHash.get(c.current.hash)?.shift();
      if (from) { renamedFrom.add(from); out.push({ ...c, kind: 'renamed', from }); continue; }
    }
    out.push({ ...c });
  }
  return out.filter((c) => !(c.kind === 'deleted' && renamedFrom.has(c.path)));
}

export const verificationKey = (c: { kind: string; current?: FileState }) => (c.kind === 'deleted' ? 'deleted' : c.current?.hash ?? '');
/** Changes whose current content has not been covered by a completed verification. */
export function awaitingVerification(s: SessionData): EffectiveChange[] {
  return effectiveChanges(s).filter((c) => c.verifiedHash !== verificationKey(c));
}

export interface Counts { created: number; modified: number; deleted: number; renamed: number; total: number; awaiting: number; byCategory: Record<Category, number> }
export function counts(s: SessionData): Counts {
  const eff = effectiveChanges(s);
  const n = (k: ChangeKind) => eff.filter((c) => c.kind === k).length;
  const byCategory = { source: 0, test: 0, config: 0, dependency: 0, migration: 0, docs: 0, other: 0 } as Record<Category, number>;
  for (const c of eff) byCategory[c.category]++;
  return { created: n('created'), modified: n('modified'), deleted: n('deleted'), renamed: n('renamed'), total: eff.length,
    awaiting: awaitingVerification(s).length, byCategory };
}

/** Marks session state after a change arrives: an "awaiting review" estimate is withdrawn when work continues. */
export function noteActivity(s: SessionData): void {
  if (s.status === 'awaiting_review') { s.status = 'tracking'; s.completion = undefined; }
}

export function markCompletion(s: SessionData, c: Completion): boolean {
  if (s.status !== 'tracking' && s.status !== 'awaiting_review') return false;
  // never downgrade a confirmed signal to an estimate
  if (s.completion?.kind === 'agent_signal' && c.kind === 'inactivity_estimate') return false;
  s.status = 'awaiting_review';
  s.completion = c;
  return true;
}

/** True when the inactivity estimate should fire: changes exist, nothing changed for `seconds`, still tracking. */
export function inactivityReached(s: SessionData, seconds: number, now: number): boolean {
  return seconds > 0 && s.status === 'tracking' && !!s.lastChangeAt && Object.keys(s.changes).length > 0 && now - s.lastChangeAt >= seconds * 1000;
}

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
/** Validates the content of an agent signal file. Untrusted input: anything unexpected is rejected. */
export function parseAgentSignal(text: string): { event: 'start' | 'stop'; agent: string } | undefined {
  if (text.length > 2000) return undefined;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') return undefined;
    if (d.event !== 'start' && d.event !== 'stop') return undefined;
    const agent = typeof d.agent === 'string' && AGENT_NAME.test(d.agent) ? d.agent : 'unknown agent';
    return { event: d.event, agent };
  } catch { return undefined; }
}

export function serialize(s: SessionData): string { return JSON.stringify(s); }
export function deserialize(text: string): SessionData | undefined {
  try {
    const d = JSON.parse(text);
    if (d?.version !== 1 || typeof d.id !== 'string' || typeof d.baseline !== 'object' || typeof d.changes !== 'object') return undefined;
    if (!['tracking', 'paused', 'awaiting_review', 'ended'].includes(d.status)) return undefined;
    d.skipped = Array.isArray(d.skipped) ? d.skipped : [];
    d.warnings = Array.isArray(d.warnings) ? d.warnings : [];
    d.baselineContent = d.baselineContent ?? {};
    return d as SessionData;
  } catch { return undefined; }
}
