import { cacheLife } from 'next/cache';
import { API_URL } from './config';

// Plans come from the backend (backend/app/billing/plans.py): the single source of truth for limits, features and prices.
export type Plan = { id: string; name: string; status: string; tagline: string; prices: null | Record<string, number>;
  limits: Record<string, number | null>; features: Record<string, unknown> };
export type Plans = { billing_live: boolean; plans: Plan[] };

export async function getPlans(): Promise<Plans | null> {
  'use cache';
  cacheLife('hours');
  try {
    const r = await fetch(`${API_URL}/api/v1/plans`);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}
