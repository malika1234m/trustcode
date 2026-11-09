import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { api, ApiError } from './api';

/** Authenticated read. 401 -> sign in again; 403/404 -> not found (no information leak). */
export async function load<T = unknown>(path: string, next = '/dashboard'): Promise<T> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/login?next=${encodeURIComponent(next)}`);
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
}

export type Me = { id: string; email: string | null; role: string; created_at: string; local: boolean };
export type Entitlements = {
  plan: { id: string; name: string }; status: string;
  limits: { verifications_per_month: number | null; max_code_chars: number; history_days: number };
  features: { languages?: string[] } & Record<string, unknown>;
  usage: { verifications_this_month: number; remaining: number | null; resets_at: string };
};
export type Ticket = { id: string; category: string; subject: string; status: string; email: string; created_at: string; updated_at: string;
  resolved_at: string | null; assignee_id?: string | null; messages?: { author: 'customer' | 'staff'; body: string; created_at: string }[] };

export const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtTime = (s: string) => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
