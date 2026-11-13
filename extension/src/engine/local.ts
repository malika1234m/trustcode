// Local analysis (no vscode import -> unit-testable). Answers the same requests as the TrustCode server's
// verification endpoints, by running the engine on this machine and keeping history, feedback and the
// explanation profile in a local store. Nothing here opens a network connection.
import { randomBytes } from 'crypto';
import { ApiError, FetchLike, TokenStore, TrustCodeApi } from '../api';

export interface LocalJob {
  id: string; status: 'running' | 'done' | 'failed' | 'cancelled'; language?: string; code_lines: number;
  created_at: string; finished_at?: string; error?: string; result?: any;
  decision?: { decision: string; confidence?: number; rationale?: string; at: string };
}
export interface LocalProfile { experience_level: string; store_history: boolean; adaptive_suggestions: boolean }
export interface LocalState {
  version: 1; jobs: LocalJob[]; feedback: Array<{ rule?: string; rating: string; at: number }>; profile: LocalProfile;
}
export interface Persist { load(): LocalState | undefined; save(s: LocalState): void }
/** Runs one engine request and resolves with its answer; rejects with ApiError. `kill` stops a running request. */
export interface EngineRunner { run(req: Record<string, unknown>, opts?: { timeoutMs?: number; onStart?: (kill: () => void) => void }): Promise<any> }
export interface EngineOptions { profile: string; registry: boolean; runTests: boolean }

export const MAX_JOBS = 50;
export const MAX_RESULTS = 25;
export const MAX_FEEDBACK = 2000;
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const RATINGS = ['helpful', 'not_helpful', 'too_technical', 'too_simple', 'incorrect'];

export function emptyState(): LocalState {
  return { version: 1, jobs: [], feedback: [], profile: { experience_level: 'intermediate', store_history: true, adaptive_suggestions: true } };
}

/** Accepts only a well-formed state; anything else (corrupt or foreign file) starts empty rather than being trusted. */
export function readState(raw: unknown): LocalState {
  const s = raw as LocalState;
  if (!s || s.version !== 1 || !Array.isArray(s.jobs) || !Array.isArray(s.feedback) || typeof s.profile !== 'object' || !s.profile) return emptyState();
  const base = emptyState().profile;
  return {
    version: 1,
    jobs: s.jobs.filter((j) => j && typeof j.id === 'string' && typeof j.created_at === 'string').slice(0, MAX_JOBS)
      .map((j) => (j.status === 'running' ? { ...j, status: 'failed' as const, error: 'interrupted: VS Code closed before the analysis finished' } : j)),
    feedback: s.feedback.filter((f) => f && RATINGS.includes(f.rating)).slice(-MAX_FEEDBACK),
    profile: {
      experience_level: LEVELS.includes(s.profile.experience_level) ? s.profile.experience_level : base.experience_level,
      store_history: typeof s.profile.store_history === 'boolean' ? s.profile.store_history : base.store_history,
      adaptive_suggestions: typeof s.profile.adaptive_suggestions === 'boolean' ? s.profile.adaptive_suggestions : base.adaptive_suggestions,
    },
  };
}

/** What is written to disk: history only if the user keeps it, and full results only for the most recent runs. */
export function toStored(s: LocalState): LocalState {
  const jobs = s.profile.store_history ? s.jobs.filter((j) => j.status !== 'running').slice(0, MAX_JOBS)
    .map((j, i) => (i < MAX_RESULTS ? j : { ...j, result: undefined })) : [];
  return { ...s, jobs };
}

const newId = () => randomBytes(16).toString('hex');   // same shape as a server job id
const meta = (j: LocalJob) => ({ id: j.id, status: j.status === 'done' && !j.result ? 'expired' : j.status, language: j.language, code_lines: j.code_lines,
  created_at: j.created_at, finished_at: j.finished_at, error: j.error });

export class LocalAnalysis {
  private state: LocalState;
  private running = new Map<string, { promise: Promise<void>; kill?: () => void }>();
  private reports = new Map<string, any>();   // multi-file reports: kept for this window only (the Session tab stores its own runs)
  private views = new Map<string, any>();

  constructor(private engine: EngineRunner, private persist: Persist, private options: () => EngineOptions) {
    this.state = readState(persist.load());
  }

  /** Paths this class answers. Everything else belongs to the account server. */
  static handles(path: string): boolean {
    return /^\/(verifications|session-verifications|feedback|profile)(\/|\?|$)/.test(path);
  }

  private save() { this.persist.save(toStored(this.state)); }
  private job(id: string): LocalJob {
    const j = this.state.jobs.find((x) => x.id === id);
    if (!j) throw new ApiError(404, 'not_found', 'verification not found');
    return j;
  }
  private viewOptions(level?: string) {
    const p = this.state.profile;
    return {
      level: level && LEVELS.includes(level) ? level : undefined, selected_level: p.experience_level, suggestions: p.adaptive_suggestions,
      ratings: this.state.feedback.map((f) => f.rating),
      rule_ratings: this.state.feedback.filter((f) => f.rule).map((f) => [f.rule, f.rating]),
    };
  }
  private add(job: LocalJob) {
    this.state.jobs.unshift(job);
    for (const old of this.state.jobs.splice(MAX_JOBS)) { this.reports.delete(old.id); }
  }
  private start(job: LocalJob, req: Record<string, unknown>, timeoutMs: number, done: (answer: any) => void) {
    this.add(job);
    const entry: { promise: Promise<void>; kill?: () => void } = { promise: Promise.resolve() };
    entry.promise = this.engine.run(req, { timeoutMs, onStart: (kill) => { entry.kill = kill; } }).then((answer) => {
      if (job.status === 'cancelled') return;
      done(answer);
      job.status = 'done';
    }, (e) => {
      if (job.status === 'cancelled') return;
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    }).finally(() => {
      job.finished_at = new Date().toISOString();
      this.running.delete(job.id);
      this.save();
    });
    this.running.set(job.id, entry);
  }

  submit(code: string, language: string | undefined, task: string | undefined, tests: string | undefined): Promise<any> {
    const o = this.options();
    const job: LocalJob = { id: newId(), status: 'running', language, code_lines: code.split('\n').length, created_at: new Date().toISOString() };
    this.start(job, { op: 'verify', code, language, task: task || undefined, tests: tests || undefined, run_tests: !!tests && o.runTests,
      registry: o.registry, profile: o.profile, ...this.viewOptions() }, 300_000, (a) => {
      job.result = a.result;
      job.language = a.result?.language ?? job.language;
      this.views.clear();
    });
    return Promise.resolve(meta(job));
  }

  cancel(id: string) {
    const j = this.job(id);
    if (j.status !== 'running') return;
    j.status = 'cancelled';
    this.running.get(id)?.kill?.();
  }

  async waitForResult(jobId: string, isCancelled: () => boolean, onTick?: (status: string) => void, _intervalMs = 500, maxMs = 300_000): Promise<any> {
    const t0 = Date.now();
    const j = this.job(jobId);
    while (this.running.has(jobId)) {
      if (isCancelled()) { this.cancel(jobId); return { status: 'cancelled' }; }
      if (Date.now() - t0 > maxMs) { this.cancel(jobId); throw new ApiError(0, 'timeout', 'the analysis is taking too long and was stopped'); }
      onTick?.('running');
      await Promise.race([this.running.get(jobId)!.promise, new Promise((r) => setTimeout(r, 150))]);
    }
    return { ...meta(j), status: j.status, result: j.result };
  }

  async request(method: string, path: string, body?: any): Promise<any> {
    const [route, query = ''] = path.split('?');
    const parts = route.split('/').filter(Boolean);
    const q = new URLSearchParams(query);
    if (parts[0] === 'profile') {
      if (method === 'PATCH' && body && typeof body === 'object') {
        const p = this.state.profile;
        if (LEVELS.includes(body.experience_level)) p.experience_level = body.experience_level;
        if (typeof body.store_history === 'boolean') p.store_history = body.store_history;
        if (typeof body.adaptive_suggestions === 'boolean') p.adaptive_suggestions = body.adaptive_suggestions;
        this.views.clear();
        this.save();
      }
      // wording by an LLM needs a server: it is never available for local analysis
      return { ...this.state.profile, allow_llm: false, llm_available: false, role: 'user', local: true };
    }
    if (parts[0] === 'feedback' && method === 'POST') {
      if (!RATINGS.includes(body?.rating)) throw new ApiError(422, 'invalid', 'unknown rating');
      let rule: string | undefined;
      if (typeof body.job_id === 'string' && typeof body.finding_id === 'string') {
        const report = this.reports.get(body.job_id);
        const pool: any[] = report ? (report.files ?? []).flatMap((f: any) => f.findings ?? [])
          : (this.state.jobs.find((j) => j.id === body.job_id)?.result?.checks ?? []).flatMap((c: any) => c.findings ?? []);
        const hit = pool.find((x) => x?.id === body.finding_id);
        if (hit) rule = `${hit.tool}:${hit.rule_id}`.slice(0, 120);
      }
      this.state.feedback.push({ rule, rating: body.rating, at: Date.now() });
      this.state.feedback.splice(0, Math.max(0, this.state.feedback.length - MAX_FEEDBACK));
      this.views.clear();
      this.save();
      return { id: `fb-${this.state.feedback.length}` };
    }
    if (parts[0] === 'session-verifications' && method === 'POST') {
      const o = this.options();
      const files: any[] = Array.isArray(body?.files) ? body.files : [];
      const lines = files.filter((f) => f?.change !== 'context' && f?.change !== 'related').reduce((n, f) => n + String(f?.content ?? '').split('\n').length, 0);
      const job: LocalJob = { id: newId(), status: 'running', language: 'session', code_lines: lines, created_at: new Date().toISOString() };
      this.start(job, { op: 'session', request: { files, workspace_paths: body?.workspace_paths ?? [], depth: body?.depth ?? 'standard' },
        registry: o.registry, profile: o.profile, ...this.viewOptions() }, 900_000, (a) => {
        this.reports.set(job.id, { ...a.report, label: body?.label, job_id: job.id });
        if (this.reports.size > 40) this.reports.delete(this.reports.keys().next().value as string);
      });
      return meta(job);
    }
    if (parts[0] === 'verifications') {
      if (parts.length === 1 && method === 'GET') {
        const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 20));
        return { items: this.state.jobs.slice(0, limit).map(meta), next_cursor: null };
      }
      const j = this.job(parts[1] ?? '');
      if (parts.length === 2 && method === 'GET') return { ...meta(j), result: j.result };
      if (parts[2] === 'cancel' && method === 'POST') { this.cancel(j.id); return meta(j); }
      if (parts[2] === 'decision' && method === 'POST') {
        j.decision = { decision: String(body?.decision), confidence: body?.confidence, rationale: body?.rationale, at: new Date().toISOString() };
        this.save();
        return { id: j.id };
      }
      if (parts[2] === 'session-report' && method === 'GET') {
        const r = this.reports.get(j.id);
        if (!r) throw new ApiError(409, 'conflict', `verification is ${j.status}; no result to explain`);
        return r;
      }
      if (parts[2] === 'explanation' && method === 'GET') {
        if (j.status !== 'done' || !j.result) throw new ApiError(409, 'conflict', `verification is ${j.status === 'done' ? 'no longer stored' : j.status}; no result to explain`);
        const level = q.get('level') ?? undefined;
        const key = `${j.id}|${level ?? ''}`;
        if (!this.views.has(key)) {
          this.views.set(key, (await this.engine.run({ op: 'explain', result: j.result, ...this.viewOptions(level) }, { timeoutMs: 60_000 })).view);
          if (this.views.size > 60) this.views.delete(this.views.keys().next().value as string);
        }
        return this.views.get(key);
      }
    }
    throw new ApiError(404, 'not_found', `not available for local analysis: ${method} ${route}`);
  }

  /** Removes everything kept on this machine: history, results, feedback and the profile. */
  clear() {
    for (const id of [...this.running.keys()]) this.cancel(id);
    this.state = emptyState();
    this.reports.clear();
    this.views.clear();
    this.save();
  }
  counts() { return { runs: this.state.jobs.length, feedback: this.state.feedback.length }; }
}

/** The API the rest of the extension talks to: verification requests go to the local engine when it is selected. */
export class RoutedApi extends TrustCodeApi {
  constructor(baseUrl: () => string, store: TokenStore, timeoutMs: () => number, private localAnalysis: LocalAnalysis, private useLocal: () => boolean,
              fetchImpl?: FetchLike) {
    super(baseUrl, store, timeoutMs, fetchImpl ?? (globalThis as any).fetch);
  }
  isLocal(): boolean { return this.useLocal(); }
  override request(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string>; retry?: boolean; timeoutMs?: number } = {}): Promise<any> {
    return this.useLocal() && LocalAnalysis.handles(path) ? this.localAnalysis.request(method, path, body) : super.request(method, path, body, opts);
  }
  override submit(code: string, language: string | undefined, task: string | undefined, tests: string | undefined) {
    return this.useLocal() ? this.localAnalysis.submit(code, language, task, tests) : super.submit(code, language, task, tests);
  }
  override waitForResult(jobId: string, isCancelled: () => boolean, onTick?: (status: string) => void, intervalMs = 500, maxMs = 180000) {
    return this.useLocal() ? this.localAnalysis.waitForResult(jobId, isCancelled, onTick, intervalMs, maxMs) : super.waitForResult(jobId, isCancelled, onTick, intervalMs, maxMs);
  }
}
