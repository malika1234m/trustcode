// Licence lifecycle (no vscode import -> unit-testable with injected storage, network and clock).
//
// Startup never waits for the network: the stored licence is verified on this device and the plan decided at once.
// The server is contacted only when the licence is due for a refresh (refresh_after, normally once a day), after a
// failed attempt (exponential back-off from 1 minute up to 6 hours), or when the user asks. Storage is the editor's
// SecretStorage, which VS Code keeps in the operating system's keychain (Keychain on macOS).
import { ApiError, FetchLike } from '../api';
import { DeviceIdentity, newDevice, signedRequest, validDevice } from './device';
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
}

interface Stored { token?: string; revoked?: { code: string; message: string }; clockFloor?: number; offline?: boolean; lastAttempt?: number }

const DEVICE_KEY = 'trustcode.licence.device';
const MIN = 60_000;
export const BACKOFF_MS = [1, 2, 4, 8, 16, 32, 60, 120, 240, 360].map((m) => m * MIN);
const TICK_MS = 60 * MIN;
const REFUSALS = new Set(['device_not_recognised', 'device_deactivated', 'device_revoked', 'account_suspended']);

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

  constructor(private d: LicenceDeps) {
    this.view = evaluate({ nowMs: this.now(), clockFloorMs: 0, offline: false, freeFeatures: d.freeFeatures });
  }

  private now() { return (this.d.now ?? Date.now)(); }
  private key() { return `trustcode.licence:${normaliseBackend(this.d.backend())}`; }
  private schedule(fn: () => void, ms: number): Timer {
    if (this.d.schedule) return this.d.schedule(fn, ms);
    const t = setTimeout(fn, ms);
    (t as any).unref?.();
    return { cancel: () => clearTimeout(t) };
  }

  private async readJson<T>(k: string): Promise<T | undefined> {
    const raw = await this.d.secrets.get(k);
    if (raw === undefined) return undefined;
    try { return JSON.parse(raw) as T; } catch {
      this.d.log('Stored licence data was unreadable and has been reset.');
      await this.d.secrets.delete(k);
      return undefined;
    }
  }
  private async save() { await this.d.secrets.store(this.key(), JSON.stringify(this.rec)); }

  private async loadDevice(create: boolean): Promise<DeviceIdentity | undefined> {
    if (this.device) return this.device;
    const d = await this.readJson<DeviceIdentity>(DEVICE_KEY);
    if (validDevice(d)) return (this.device = d);
    if (!create) return undefined;
    this.device = newDevice();
    await this.d.secrets.store(DEVICE_KEY, JSON.stringify(this.device));
    return this.device;
  }

  /** Verifies the stored licence and decides the plan. No network. */
  async load(): Promise<LicenceView> {
    this.rec = (await this.readJson<Stored>(this.key())) ?? {};
    this.payload = undefined;
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

  /** Remembers the latest plausible time, so a clock turned back later is noticed. Written at most every 10 minutes. */
  private async touchClock() {
    const t = this.now(), floor = this.rec.clockFloor ?? 0;
    const rolledBack = t + 10 * MIN < Math.max(floor, this.payload ? this.payload.iat * 1000 : 0);
    if (!rolledBack && t > floor + 10 * MIN) { this.rec.clockFloor = t; await this.save(); }
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
    this.rec = { token: r.licence, clockFloor: serverMs, offline: false, lastAttempt: this.now() };
    this.failures = 0;
    await this.save();
  }

  /** Right after sign-in: registers this device and stores the first licence. */
  async activate(): Promise<LicenceView> {
    const device = await this.loadDevice(true);
    try {
      const r = await this.d.authed('POST', '/licence/activate', { device_id: device!.id, public_key: device!.publicKey, name: this.d.deviceName, platform: this.d.platform });
      await this.accept(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'licensing_not_configured') { this.d.log('The server does not issue licences; the Free plan needs none.'); return this.publish(); }
      throw e;
    } finally { this.publish(); }
    this.startTimers();
    return this.view;
  }

  /** Contacts the server only when due (or forced). Never throws: failures become the offline state. */
  sync(force = false): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(force).finally(() => { this.syncing = undefined; });
    return this.syncing;
  }

  private async doSync(force: boolean) {
    if (!this.payload || this.disposed) return;
    const due = this.now() >= this.payload.refresh_after * 1000 || !!this.rec.offline || this.view.status === 'connection_required';
    if (!force && !due) return;
    const device = await this.loadDevice(false);
    if (!device) return;
    const req = signedRequest(device, this.payload.sub, this.now());
    this.device = req.device;
    await this.d.secrets.store(DEVICE_KEY, JSON.stringify(req.device));
    try {
      const res = await this.post('/licence/refresh', req.body, req.signature);
      await this.accept(res);
      this.d.log('Licence refreshed.');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      if (e instanceof ApiError && REFUSALS.has(code)) {
        this.d.log(`The server no longer accepts this device (${code}).`);
        this.payload = undefined;
        this.rec = { revoked: { code, message: e.message }, clockFloor: this.rec.clockFloor };
        await this.save();
      } else {
        if (e instanceof ApiError && code === 'replayed_request') { this.device = { ...req.device, counter: req.device.counter + 1000 }; await this.d.secrets.store(DEVICE_KEY, JSON.stringify(this.device)); }
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
      const req = signedRequest(device, this.payload.sub, this.now());
      this.device = req.device;
      await this.d.secrets.store(DEVICE_KEY, JSON.stringify(req.device));
      await this.post('/licence/release', req.body, req.signature).catch((e) => this.d.log(`The server was not told about the sign-out (${e?.message ?? e}).`));
    }
    this.payload = undefined;
    this.rec = { clockFloor: this.rec.clockFloor };
    this.retryTimer?.cancel();
    await this.save();
    this.publish();
  }

  /** The editor regained focus: a good moment to retry if the last attempt failed a while ago. */
  nudge() {
    if (this.rec.offline && this.now() - (this.rec.lastAttempt ?? 0) > 2 * MIN) void this.sync();
  }

  startTimers() {
    if (this.tickTimer || this.disposed) return;
    const tick = () => { void this.touchClock().then(() => this.sync()).then(() => this.publish()); this.tickTimer = this.schedule(tick, TICK_MS); };
    this.tickTimer = this.schedule(tick, 15_000);   // first check shortly after startup, never during it
  }

  /** True when the plan currently in force includes `feature`. The server checks again for anything it serves. */
  allows(feature: string): boolean {
    const v = this.view.features[feature];
    return v === true || (typeof v === 'string' && v.length > 0);
  }

  dispose() { this.disposed = true; this.retryTimer?.cancel(); this.tickTimer?.cancel(); }
}
