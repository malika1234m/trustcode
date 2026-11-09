import 'server-only';
import { API_URL } from './config';
import { getAccessToken } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ErrorBody = { error?: { message?: string | { msg: string }[] } };

function messageOf(body: ErrorBody, status: number): string {
  const m = body?.error?.message;
  if (Array.isArray(m)) return m.map((x) => x.msg).join('; ');
  return typeof m === 'string' ? m : `Request failed (${status})`;
}

/** Server-side call to the TrustCode API. Tokens never reach the browser. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; auth?: boolean; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = init.token ?? (init.auth === false ? undefined : await getAccessToken());
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? 'GET', headers, cache: 'no-store',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, messageOf(body, res.status));
  return body as T;
}
