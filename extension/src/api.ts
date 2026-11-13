// Minimal TrustCode API client (no vscode import -> unit-testable). Uses global fetch (Node 18+).

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public retryAfter?: number) {
    super(message);
  }
}

export interface Tokens { access: string; refresh?: string }

export interface TokenStore {
  get(): Promise<Tokens | undefined>;
  set(t: Tokens | undefined): Promise<void>;
}

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; json(): Promise<any>; text(): Promise<string> }>;

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `Cannot reach the TrustCode backend (${e.message}). Is it running?`;
    if (e.status === 401) return 'Your session has expired or the credentials are invalid. Please sign in again.';
    if (e.status === 429) return `Too many requests. Try again in ${e.retryAfter ?? 60}s.`;
    if (e.status >= 500) return `The backend reported an internal error${e.requestId ? ` (request ${e.requestId})` : ''}.`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Set by the extension so that the licence follows the traffic the client already makes. */
export interface ApiHooks {
  /** Extra headers for a request (the device proof for server analysis). */
  headers?: (method: string, path: string) => Promise<Record<string, string>>;
  /** The account's revocation version, returned by the server with every signed-in response. */
  onLicenceRev?: (rev: number) => void;
  /** The server no longer accepts this account's session (sign-in expired, or the account was suspended or deleted). */
  onUnauthorized?: () => void;
}

export class TrustCodeApi {
  hooks: ApiHooks = {};
  constructor(private baseUrl: () => string, private store: TokenStore, private timeoutMs: () => number,
              private fetchImpl: FetchLike = (globalThis as any).fetch) {}

  async request(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string>; retry?: boolean; timeoutMs?: number } = {}): Promise<any> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
    const tokens = auth ? await this.store.get() : undefined;
    if (auth && tokens) headers.Authorization = `Bearer ${tokens.access}`;
    if (auth && this.hooks.headers) Object.assign(headers, await this.hooks.headers(method, path).catch(() => ({})));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(this.timeoutMs(), opts.timeoutMs ?? 0));
    let res;
    try {
      res = await this.fetchImpl(this.baseUrl().replace(/\/$/, '') + '/api/v1' + path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e: any) {
      throw new ApiError(0, 'network', e?.name === 'AbortError' ? 'request timed out' : (e?.message ?? 'network error'));
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && auth && tokens?.refresh && opts.retry !== false) {
      if (await this.tryRefresh(tokens.refresh)) return this.request(method, path, body, { ...opts, retry: false });
    }
    if (auth) {
      const rev = res.headers.get('x-trustcode-licence-rev');
      if (rev !== null && /^\d{1,9}$/.test(rev)) { try { this.hooks.onLicenceRev?.(Number(rev)); } catch { /* never breaks a request */ } }
      if (res.status === 401 && tokens) { try { this.hooks.onUnauthorized?.(); } catch { /* never breaks a request */ } }
    }
    if (!res.ok) {
      let payload: any = {};
      try { payload = await res.json(); } catch { /* non-JSON error */ }
      const err = payload?.error ?? {};
      const msg = Array.isArray(err.message) ? err.message.map((m: any) => m.msg).join('; ') : (err.message ?? `HTTP ${res.status}`);
      throw new ApiError(res.status, err.code ?? 'error', msg, err.request_id ?? res.headers.get('x-request-id') ?? undefined,
        Number(res.headers.get('retry-after')) || undefined);
    }
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  private async tryRefresh(refresh: string): Promise<boolean> {
    try {
      const t = await this.request('POST', '/auth/refresh', { refresh_token: refresh }, { auth: false, retry: false });
      await this.store.set({ access: t.access_token, refresh: t.refresh_token });
      return true;
    } catch {
      await this.store.set(undefined);
      return false;
    }
  }

  async login(email: string, password: string) {
    const t = await this.request('POST', '/auth/login', { email, password }, { auth: false });
    await this.store.set({ access: t.access_token, refresh: t.refresh_token });
  }

  async register(email: string, password: string) {
    const t = await this.request('POST', '/auth/register', { email, password }, { auth: false });
    await this.store.set({ access: t.access_token, refresh: t.refresh_token });
  }

  async localLogin(secret: string) {
    const t = await this.request('POST', '/auth/local', undefined, { auth: false, headers: { 'X-TrustCode-Local-Secret': secret } });
    await this.store.set({ access: t.access_token, refresh: t.refresh_token });
  }

  submit(code: string, language: string | undefined, task: string | undefined, tests: string | undefined) {
    return this.request('POST', '/verifications', { code, language, task: task || undefined, tests: tests || undefined, client_consent: true });
  }

  /** Poll until finished, cancelled, or `isCancelled()` returns true. */
  async waitForResult(jobId: string, isCancelled: () => boolean, onTick?: (status: string) => void, intervalMs = 500, maxMs = 180000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (isCancelled()) {
        await this.request('POST', `/verifications/${jobId}/cancel`).catch(() => undefined);
        return { status: 'cancelled' };
      }
      const j = await this.request('GET', `/verifications/${jobId}`);
      onTick?.(j.status);
      if (!['queued', 'running'].includes(j.status)) return j;
      await new Promise(r => setTimeout(r, intervalMs));
      intervalMs = Math.min(intervalMs * 1.25, 2000);  // gentle back-off: results noticed within <=2 s, <=~35 polls/min
    }
    throw new ApiError(0, 'timeout', 'verification is taking too long; try again later');
  }
}
