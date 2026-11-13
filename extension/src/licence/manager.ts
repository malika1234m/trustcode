// Licence lifecycle (no vscode import -> unit-testable with injected storage, network and clock).
//
// Startup never waits for the network: the stored licence is verified on this device and the plan decided at once.
// The server is contacted only:
//   - for a status check (small, device-signed, nothing issued) shortly after startup and then every `check_after`
//     seconds while online (1-4 hours, set by the server), so a removed or blocked device stops within that time;
//   - for a refresh when the licence is due (refresh_after, normally once a day), when a status check or the
//     revocation version on another response says the licence is no longer current, or when the user asks;
//   - after a failed attempt (exponential back-off from 1 minute up to 6 hours).
// Storage is the editor's SecretStorage, which VS Code keeps in the operating system's keychain (Keychain on macOS).
import { ApiError, FetchLike } from '../api';
import { DeviceIdentity, deviceProof, newDevice, signedRequest, validDevice } from './device';
import { evaluate, LicenceView } from './state';
import { LicencePayload, verifyLicence } from './token';

export interface SecretLike { get(k: string): PromiseLike<string | undefined>; store(k: string, v: string): PromiseLike<void>; delete(k: string): PromiseLike<void> }
export interface Timer { cancel(): void }

export interface LicenceDeps {
  secrets: SecretLike;
  fetch: FetchLike;
  backend: () => string;
  keys: Readonly<Record<string, string>>;
  /** An account-authenticated API call (used only for activation, right after the user signs in). */
  authed: (method: string, path: string, body?: unknown) => Promise<any>;
  onChange: (v: LicenceView) => void;
  log: (m: string) => void;
  deviceName: string; platform: string;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => Timer;
  timeoutMs?: number;
  freeFeatures?: Record<string, unknown>;
  /** Integrity signals sent with licence requests: this extension's version and a hash of its compiled code. */
  client?: () => { v?: string; build?: string };
}

interface Stored {
  token?: string; revoked?: { code: string; message: string }; clockFloor?: number; offline?: boolean; lastAttempt?: number;
  /** Last time the server answered a status check or a refresh (this computer's clock, ms). */
  lastContact?: number;
  /** Server time minus this computer's time at the last contact (ms): lets a device proof carry the server's time. */
  skew?: number;
}

const DEVICE_KEY = 'trustcode.licence.device';
const MIN = 60_000;
export const BACKOFF_MS = [1, 2, 4, 8, 16, 32, 60, 120, 240, 360].map((m) => m * MIN);
export const TICK_MS = 15 * MIN;
/** Shortly after startup the status is confirmed online, unless the server answered within this time (window reloads). */
export const STARTUP_MAX_AGE_MS = 5 * MIN;
export const STARTUP_DELAY_MS = 15_000;
export const DEFAULT_CHECK_MS = 60 * MIN;
const CLOCK_WRITE_MS = 30 * MIN;
const REFUSALS = new Set(['device_not_recognised', 'device_deactivated', 'device_revoked', 'account_suspended']);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const normaliseBackend = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

export class LicenceManager {
  view: LicenceView;
  payload?: LicencePayload;
  private rec: Stored = {};
  private device?: DeviceIdentity;
  private failures = 0;
  private retryTimer?: Timer;
  private tickTimer?: Timer;
  private syncing?: Promise<void>;
  private disposed = false;
  /** The server has no status endpoint (older than 1.2.0): fall back to the daily refresh only. */
  private statusUnsupported = false;
  private seenRev?: number;
  private lastUnauthorizedCheck = 0;

  constructor(private d: LicenceDeps) {
    this.view = evaluate({ nowMs: this.now(), clockFloorMs: 0, offline: false, freeFeatures: d.freeFeatures });   // until load(): not usable
  }

  private now() { return (this.d.now ?? Date.now)(); }
  private key() { return `trustcode.licence:${normaliseBackend(this.d.backend())}`; }
  private schedule(fn: () => void, ms: number): Timer {
    if (this.d.schedule) return this.d.schedule(fn, ms);
    const t = setTimeout(fn, ms);
    (t as any).unref?.();
    return { cancel: () => clearTimeout(t) };
  }

  private storageWarned = false;
  private storageFailed(e: unknown) {
    if (!this.storageWarned) this.d.log(`The editor's secret storage is not available (${e instanceof Error ? e.message : String(e)}). The licence cannot be kept between sessions.`);
    this.storageWarned = true;
  }
  /** Storage problems never throw: the licence then lives in memory for this session and the user signs in again later. */
  private async put(k: string, v: string) { try { await this.d.secrets.store(k, v); } catch (e) { this.storageFailed(e); } }
  private async readJson<T>(k: string): Promise<T | undefined> {
    let raw: string | undefined;
    try { raw = await this.d.secrets.get(k); } catch (e) { this.storageFailed(e); return undefined; }
    if (raw === undefined) return undefined;
    try {
      const v = JSON.parse(raw);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      return v as T;
    } catch {
      this.d.log('Stored licence data was unreadable and has been reset.');
      try { await this.d.secrets.delete(k); } catch (e) { this.storageFailed(e); }
      return undefined;
    }
  }
  private async save() { await this.put(this.key(), JSON.stringify(this.rec)); }

  private async loadDevice(create: boolean): Promise<DeviceIdentity | undefined> {
    if (this.device) return this.device;
    const d = await this.readJson<DeviceIdentity>(DEVICE_KEY);
    if (validDevice(d)) return (this.device = d);
    if (!create) return undefined;
    this.device = newDevice();
    await this.put(DEVICE_KEY, JSON.stringify(this.device));
    return this.device;
  }

  /** Verifies the stored licence and decides the plan. No network. */
  async load(): Promise<LicenceView> {
    const raw: any = (await this.readJson<Stored>(this.key())) ?? {};
    // stored values are untrusted input: keep only fields of the expected type
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    this.rec = { token: typeof raw.token === 'string' ? raw.token : undefined, clockFloor: num(raw.clockFloor), offline: raw.offline === true,
      lastAttempt: num(raw.lastAttempt), lastContact: num(raw.lastContact), skew: num(raw.skew),
      revoked: raw.revoked && typeof raw.revoked.code === 'string' && typeof raw.revoked.message === 'string' ? { code: raw.revoked.code, message: raw.revoked.message.slice(0, 300) } : undefined };
    this.payload = undefined;
    this.device = undefined;       // re-read: the stored key may have been removed or replaced
    this.seenRev = undefined;
    this.statusUnsupported = false;
    if (this.rec.token) {
      const v = verifyLicence(this.rec.token, this.d.keys);
      const device = await this.loadDevice(false);
      if (!v.ok) this.d.log(`The stored licence was rejected (${v.reason}); TrustCode is using the Free plan.`);
      else if (!device || v.payload.dev !== device.id) this.d.log('The stored licence belongs to another device; TrustCode is using the Free plan.');
      else this.payload = v.payload;
      if (!this.payload) { delete this.rec.token; await this.save(); }
    }
    await this.touchClock();
    return this.publish();
  }

  /** Remembers the latest plausible time, so a clock turned back later is noticed. Written at most every 30 minutes. */
  private async touchClock() {
    const t = this.now(), floor = this.rec.clockFloor ?? 0;
    const rolledBack = t + 10 * MIN < Math.max(floor, this.payload ? this.payload.iat * 1000 : 0);
    if (!rolledBack && t > floor + CLOCK_WRITE_MS) { this.rec.clockFloor = t; await this.save(); }
  }

  /** How often the status is confirmed while online: set by the server in the licence, kept within 1-4 hours. */
  checkEveryMs(): number {
    const s = this.payload?.check_after;
    return typeof s === 'number' && Number.isFinite(s) ? clamp(s * 1000, 60 * MIN, 240 * MIN) : DEFAULT_CHECK_MS;
  }
  private extras(): Record<string, unknown> {
    const c = this.d.client?.() ?? {};
    return { lid: this.payload?.lid, rev: this.payload?.rev, v: c.v, build: c.build };
  }

  private publish(): LicenceView {
    this.view = evaluate({ payload: this.payload, nowMs: this.now(), clockFloorMs: this.rec.clockFloor ?? 0, offline: !!this.rec.offline,
      revoked: this.rec.revoked, freeFeatures: this.d.freeFeatures });
    this.d.onChange(this.view);
    return this.view;
  }

  private async accept(r: any): Promise<void> {
    const v = verifyLicence(r?.licence, this.d.keys);
    if (!v.ok) throw new ApiError(502, 'invalid_licence', 'The server sent a licence this version of TrustCode cannot verify. Update TrustCode.');
    const device = await this.loadDevice(false);
    if (!device || v.payload.dev !== device.id) throw new ApiError(502, 'invalid_licence', 'The server sent a licence for another device.');
    this.payload = v.payload;
    // the server's clock is the anchor: it also repairs a floor that a wrong clock had pushed into the future
    const serverMs = Number.isInteger(r.server_time) ? r.server_time * 1000 : v.payload.iat * 1000;
    this.rec = { token: r.licence, clockFloor: serverMs, offline: false, lastAttempt: this.now(), lastContact: this.now(), skew: serverMs - this.now() };
    this.failures = 0;
    this.retryTimer?.cancel();
    await this.save();
  }

  /** Right after sign-in: registers this device and stores the first licence. */
  async activate(): Promise<LicenceView> {
    const device = await this.loadDevice(true);
    try {
      const c = this.d.client?.() ?? {};
      const r = await this.d.authed('POST', '/licence/activate', { device_id: device!.id, public_key: device!.publicKey, name: this.d.deviceName,
        platform: this.d.platform, version: c.v, build: c.build });
      await this.accept(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'licensing_not_configured') { this.d.log('The server does not issue licences; the Free plan needs none.'); return this.publish(); }
      throw e;
    } finally { this.publish(); }
    this.startTimers();
    return this.view;
  }

  /**
   * Contacts the server only when due (or forced). Never throws: failures become the offline state.
   * `force` always refreshes the licence; `maxAgeMs` asks for a status check when the server last answered longer ago.
   */
  sync(force = false, maxAgeMs?: number): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(force, maxAgeMs).finally(() => { this.syncing = undefined; });
    return this.syncing;
  }

  private async signed(path: string): Promise<any> {
    const device = await this.loadDevice(false);
    if (!device || !this.payload) throw new ApiError(0, 'no_device', 'this device has no key');
    const req = signedRequest(device, this.payload.sub, this.now(), this.extras());
    this.device = req.device;
    await this.put(DEVICE_KEY, JSON.stringify(req.device));
    try { return await this.post(path, req.body, req.signature); } catch (e) {
      if (e instanceof ApiError && e.code === 'replayed_request') {   // the server has seen a higher counter: jump past it
        this.device = { ...req.device, counter: req.device.counter + 1000 };
        await this.put(DEVICE_KEY, JSON.stringify(this.device));
      }
      throw e;
    }
  }

  private async doSync(force: boolean, maxAgeMs?: number) {
    if (!this.payload || this.disposed) return;
    const now = this.now();
    const sinceContact = now - (this.rec.lastContact ?? this.payload.validated_at * 1000);
    const refreshDue = force || now >= this.payload.refresh_after * 1000 || this.view.status === 'connection_required';
    // against a server without the status call, only startup and a failed attempt ask early (as before 1.2.0)
    const periodic = !this.statusUnsupported && (sinceContact >= this.checkEveryMs() || sinceContact < 0);
    const statusDue = !!this.rec.offline || periodic || (maxAgeMs !== undefined && sinceContact > maxAgeMs);
    if (!refreshDue && !statusDue) return;
    if (!(await this.loadDevice(false))) return;
    try {
      let refresh = refreshDue || this.statusUnsupported;
      if (!refresh) {
        try {
          const r = await this.signed('/licence/status');
          if (!r || r.status !== 'ok') throw new ApiError(502, 'invalid_answer', 'the answer did not come from the TrustCode server');
          refresh = r.refresh === true || (Number.isInteger(r.rev) && this.payload.rev !== undefined && r.rev !== this.payload.rev);
          this.seenRev = Number.isInteger(r.rev) ? r.rev : this.seenRev;
          this.rec.offline = false; this.rec.lastAttempt = this.now(); this.rec.lastContact = this.now();
          if (Number.isInteger(r.server_time)) { this.rec.skew = r.server_time * 1000 - this.now(); this.rec.clockFloor = r.server_time * 1000; }
          this.failures = 0;
          this.retryTimer?.cancel();
          await this.save();
        } catch (e) {
          // a server from before the status call: keep to the daily refresh (and confirm now, as startup always did)
          if (e instanceof ApiError && (e.status === 404 || e.status === 405)) { this.statusUnsupported = true; refresh = true; } else throw e;
        }
      }
      if (refresh) {
        await this.accept(await this.signed('/licence/refresh'));
        this.d.log('Licence refreshed.');
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      if (e instanceof ApiError && REFUSALS.has(code)) {
        this.d.log(`The server no longer accepts this device (${code}).`);
        this.payload = undefined;
        this.rec = { revoked: { code, message: e.message }, clockFloor: this.rec.clockFloor };
        this.retryTimer?.cancel();
        await this.save();
      } else {
        this.rec.offline = true;
        this.rec.lastAttempt = this.now();
        await this.save();
        const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
        this.failures++;
        this.d.log(`Licence check could not reach the server (${e instanceof Error ? e.message : String(e)}); next try in ${Math.round(delay / MIN)} min.`);
        this.retryTimer?.cancel();
        this.retryTimer = this.schedule(() => void this.sync(), delay * (0.8 + Math.random() * 0.4));
      }
    } finally {
      this.publish();
    }
  }

  /**
   * The server returns the account's revocation version with every signed-in response. When it differs from the
   * version this licence was issued at, something changed (plan, policy, a device, the account): refresh now.
   * Costs no request when nothing changed.
   */
  noteRev(rev: number) {
    if (!this.payload || this.payload.rev === undefined || rev === this.payload.rev || rev === this.seenRev) return;
    this.seenRev = rev;
    void this.sync(true);
  }

  /** A signed-in request was refused as unauthorised: confirm this device's status now (at most once a minute). */
  noteUnauthorized() {
    if (!this.payload || this.now() - this.lastUnauthorizedCheck < MIN) return;
    this.lastUnauthorizedCheck = this.now();
    void this.sync(false, 0);
  }

  /** Header value proving to the server that a server feature is requested from this activated device. */
  async proof(): Promise<string | undefined> {
    const device = await this.loadDevice(false);
    if (!device || !this.payload || !this.view.usable) return undefined;
    try { return deviceProof(device, this.payload.sub, this.now() + (this.rec.skew ?? 0)); } catch { return undefined; }
  }

  private async post(path: string, body: string, signature: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.d.timeoutMs ?? 15000);
    let res;
    try {
      res = await this.d.fetch(normaliseBackend(this.d.backend()) + '/api/v1' + path,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TrustCode-Device-Signature': signature }, body, signal: ctrl.signal });
    } catch (e: any) {
      throw new ApiError(0, 'network', e?.name === 'AbortError' ? 'request timed out' : (e?.message ?? 'network error'));
    } finally { clearTimeout(timer); }
    let data: any = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `HTTP ${res.status}`);
    return data;
  }

  /** Sign-out: the device gives up its activation (best effort; works offline too - the licence is removed locally). */
  async release(): Promise<void> {
    const device = await this.loadDevice(false);
    if (this.payload && device) {
      await this.signed('/licence/release').catch((e) => this.d.log(`The server was not told about the sign-out (${e?.message ?? e}).`));
    }
    this.payload = undefined;
    this.rec = { clockFloor: this.rec.clockFloor };
    this.retryTimer?.cancel();
    await this.save();
    this.publish();
  }

  /** The editor regained focus: a good moment to retry if the last attempt failed a while ago. */
  nudge() {
    if (this.rec.offline ? this.now() - (this.rec.lastAttempt ?? 0) > 2 * MIN : this.now() - (this.rec.lastContact ?? 0) >= this.checkEveryMs()) void this.sync();
  }

  startTimers() {
    if (this.tickTimer || this.disposed) return;
    const tick = () => { void this.touchClock().then(() => this.sync()).then(() => this.publish()).catch(() => undefined); this.tickTimer = this.schedule(tick, TICK_MS); };
    // Shortly after startup (never during it), confirm the status online unless the server answered in the last few
    // minutes: a deleted, suspended, removed or blocked account is noticed at the next start while online.
    this.tickTimer = this.schedule(() => { void this.touchClock().then(() => this.sync(false, STARTUP_MAX_AGE_MS)).then(() => this.publish()).catch(() => undefined);
      this.tickTimer = this.schedule(tick, TICK_MS); }, STARTUP_DELAY_MS);
  }

  /** A registered account is confirmed on this device (TrustCode may run). */
  usable(): boolean { return this.view.usable; }

  /** True when the plan currently in force includes `feature`. The server checks again for anything it serves. */
  allows(feature: string): boolean {
    if (!this.view.usable) return false;
    const v = this.view.features[feature];
    return v === true || (typeof v === 'string' && v.length > 0);
  }

  dispose() { this.disposed = true; this.retryTimer?.cancel(); this.tickTimer?.cancel(); }
}
