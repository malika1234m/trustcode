// Offline licence decisions (pure -> unit-testable). The licence only carries what the server decided when it last
// saw this device; locally we may only narrow it (never widen it): paid features need a valid signature, a paid
// period that has not ended, an offline period that has not ended, and a clock that has not been turned back.
// Without a licence the plan is Free, and everything on the Free plan keeps working: no account is needed.
import type { LicencePayload } from './token';

export type LicenceStatus = 'free' | 'active' | 'offline' | 'expiring_soon' | 'subscription_expired' | 'revoked' | 'connection_required';

export interface LicenceView {
  status: LicenceStatus;
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
  const free = (status: LicenceStatus, message: string, extra: Partial<LicenceView> = {}): LicenceView =>
    ({ status, plan: FREE, features: i.freeFeatures ?? {}, message, ...extra });
  if (i.revoked) return free('revoked', `${i.revoked.message} Paid features are off. Everything on the Free plan keeps working.`);
  const p = i.payload;
  if (!p) return free('free', 'Free plan. Everything on this computer works without an account.');
  const base = { licensedPlan: p.plan, validatedAt: p.validated_at * 1000, offlineUntil: p.offline_until * 1000, paidUntil: p.paid_until === null ? null : p.paid_until * 1000 };
  const paidPlan = p.plan.id !== 'free';
  if (i.nowMs + CLOCK_TOLERANCE_MS < Math.max(i.clockFloorMs, p.iat * 1000)) {
    return free('connection_required', 'Your computer’s date and time look incorrect. Correct them, or connect to the internet so TrustCode can check your plan.', { ...base, clockProblem: true });
  }
  if (paidPlan && (p.paid_until === null || i.nowMs >= p.paid_until * 1000)) {
    return free('subscription_expired', `Your ${p.plan.name} subscription has ended. Renew it to turn paid features back on. Everything on the Free plan keeps working.`, base);
  }
  if (i.nowMs >= p.offline_until * 1000) {
    return free('connection_required', paidPlan
      ? `Connect to the internet so TrustCode can check your ${p.plan.name} subscription. Until then paid features are paused; everything on the Free plan keeps working.`
      : 'Connect to the internet to refresh your account. Everything on the Free plan keeps working.', base);
  }
  const ok = { ...base, plan: p.plan, features: p.features };
  const warn = (i.warnDays ?? 5) * DAY;
  const offlineLeft = p.offline_until * 1000 - i.nowMs;
  const paidLeft = paidPlan && p.paid_until !== null ? p.paid_until * 1000 - i.nowMs : Infinity;
  if (paidPlan && paidLeft <= warn && paidLeft <= offlineLeft) {
    return { status: 'expiring_soon', ...ok, daysLeft: days(paidLeft), message: `Your ${p.plan.name} subscription ends in ${plural(days(paidLeft))}.` };
  }
  if (i.offline && paidPlan && offlineLeft <= warn) {
    return { status: 'expiring_soon', ...ok, daysLeft: days(offlineLeft),
      message: `You’re working offline. Connect to the internet within ${plural(days(offlineLeft))} to keep your ${p.plan.name} features.` };
  }
  if (i.offline) {
    return { status: 'offline', ...ok, daysLeft: days(offlineLeft), message: 'You’re offline. Your plan was checked on this computer, so you can keep working.' };
  }
  return { status: 'active', ...ok, message: paidPlan ? `${p.plan.name} plan is active.` : 'Free plan. Signed in.' };
}
