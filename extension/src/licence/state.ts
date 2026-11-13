// Offline licence decisions (pure -> unit-testable). The licence only carries what the server decided when it last
// saw this device; locally we may only narrow it (never widen it): paid features need a valid signature, a paid
// period that has not ended, an offline period that has not ended, and a clock that has not been turned back.
// TrustCode is free, but every user needs a registered account: without a valid licence (never signed in, signed
// out, device removed, account suspended or deleted, offline period over, clock turned back) nothing runs.
import type { LicencePayload } from './token';

export type LicenceStatus = 'sign_in_required' | 'active' | 'offline' | 'expiring_soon' | 'subscription_expired' | 'revoked' | 'connection_required';

export interface LicenceView {
  status: LicenceStatus;
  /** A registered account is confirmed on this device: TrustCode may run. */
  usable: boolean;
  /** The plan whose features are on right now (Free unless the licence currently allows more). */
  plan: { id: string; name: string };
  features: Record<string, unknown>;
  /** The plan on the licence, even when it is paused. */
  licensedPlan?: { id: string; name: string };
  message: string;
  validatedAt?: number; offlineUntil?: number; paidUntil?: number | null; daysLeft?: number;
  clockProblem?: boolean;
}

export interface EvaluateInput {
  payload?: LicencePayload;
  nowMs: number;
  /** Latest time this device has trusted (ms); a clock earlier than this has been turned back. */
  clockFloorMs: number;
  /** The most recent attempt to reach the server failed (network or server error). */
  offline: boolean;
  revoked?: { code: string; message: string };
  freeFeatures?: Record<string, unknown>;
  warnDays?: number;
}

export const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;
const DAY = 86400 * 1000;
const FREE = { id: 'free', name: 'Free' };
const days = (ms: number) => Math.max(0, Math.ceil(ms / DAY));
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function evaluate(i: EvaluateInput): LicenceView {
  const blocked = (status: LicenceStatus, message: string, extra: Partial<LicenceView> = {}): LicenceView =>
    ({ status, usable: false, plan: FREE, features: {}, message, ...extra });
  if (i.revoked) return blocked('revoked', `${i.revoked.message} Sign in again to keep using TrustCode.`);
  const p = i.payload;
  if (!p) return blocked('sign_in_required', 'Sign in to use TrustCode. It is free; you only need an account.');
  const base = { licensedPlan: p.plan, validatedAt: p.validated_at * 1000, offlineUntil: p.offline_until * 1000, paidUntil: p.paid_until === null ? null : p.paid_until * 1000 };
  const paidPlan = p.plan.id !== 'free';
  if (i.nowMs + CLOCK_TOLERANCE_MS < Math.max(i.clockFloorMs, p.iat * 1000)) {
    return blocked('connection_required', 'Your computer’s date and time look incorrect. Correct them, or connect to the internet so TrustCode can confirm your account.', { ...base, clockProblem: true });
  }
  if (paidPlan && (p.paid_until === null || i.nowMs >= p.paid_until * 1000)) {
    return { status: 'subscription_expired', usable: true, plan: FREE, features: i.freeFeatures ?? {}, ...base,
      message: `Your ${p.plan.name} plan has ended. You are on the Free plan, and everything on it keeps working.` };
  }
  if (i.nowMs >= p.offline_until * 1000) {
    return blocked('connection_required', `TrustCode has been offline for ${plural(p.grace_days)}. Connect to the internet so it can confirm your account, then it continues.`, base);
  }
  const ok = { ...base, usable: true, plan: p.plan, features: p.features };
  const warn = (i.warnDays ?? 5) * DAY;
  const offlineLeft = p.offline_until * 1000 - i.nowMs;
  const paidLeft = paidPlan && p.paid_until !== null ? p.paid_until * 1000 - i.nowMs : Infinity;
  if (paidPlan && paidLeft <= warn && paidLeft <= offlineLeft) {
    return { status: 'expiring_soon', ...ok, daysLeft: days(paidLeft), message: `Your ${p.plan.name} subscription ends in ${plural(days(paidLeft))}.` };
  }
  if (i.offline && offlineLeft <= warn) {
    return { status: 'expiring_soon', ...ok, daysLeft: days(offlineLeft),
      message: `You’re working offline. Connect to the internet within ${plural(days(offlineLeft))} so TrustCode can confirm your account.` };
  }
  if (i.offline) {
    return { status: 'offline', ...ok, daysLeft: days(offlineLeft), message: 'You’re offline. Your plan was checked on this computer, so you can keep working.' };
  }
  return { status: 'active', ...ok, message: paidPlan ? `${p.plan.name} plan is active.` : 'Free plan. Your account is confirmed.' };
}
