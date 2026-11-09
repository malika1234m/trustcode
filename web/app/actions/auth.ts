'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { api, ApiError } from '@/lib/api';
import { setSession, clearSession, REFRESH } from '@/lib/session';

export type AuthState = { error?: string; email?: string };
type Tokens = { access_token: string; refresh_token?: string | null; expires_in: number };

/** Only same-site relative paths; anything else falls back to the dashboard (no open redirects). */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === 'string' ? v : '';
  // Reject control characters and whitespace (browsers strip tabs/newlines, turning "/\t/evil" into "//evil"),
  // then let the URL parser decide: only a path on our own origin is accepted.
  if (!s.startsWith('/') || /[\u0000-\u0020\u007f\\]/.test(s)) return '/dashboard';
  try {
    const u = new URL(s, 'http://local.invalid');
    if (u.origin !== 'http://local.invalid') return '/dashboard';
    const out = u.pathname + u.search + u.hash;
    // Dot segments can normalise into a protocol-relative URL ("/.//evil.com" -> "//evil.com"): check the result too.
    return out.startsWith('//') || out.startsWith('/\\') ? '/dashboard' : out;
  } catch {
    return '/dashboard';
  }
}

async function authenticate(kind: 'login' | 'register', form: FormData): Promise<AuthState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (kind === 'register') {
    if (password.length < 10) return { error: 'Use at least 10 characters for your password.', email };
    if (form.get('terms') !== 'on') return { error: 'Please accept the Terms and Privacy Policy.', email };
  }
  try {
    const t = await api<Tokens>(`/auth/${kind}`, { method: 'POST', body: { email, password }, auth: false });
    await setSession(t);
  } catch (e) {
    return { error: friendly(e, kind), email };
  }
  redirect(safeNext(form.get('next')));
}

/** Turn API errors into messages that say what happened and what to do next. */
function friendly(e: unknown, kind: 'login' | 'register'): string {
  if (!(e instanceof ApiError)) return 'TrustCode could not be reached. Check your connection and try again.';
  if (e.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  if (kind === 'login' && e.status === 401) return 'That email and password don’t match an account. Check both, or create an account.';
  if (kind === 'register' && e.status === 409) return 'An account with this email already exists. Sign in instead.';
  const m = e.message.trim();
  return m ? m[0].toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.') : 'Something went wrong. Please try again.';
}


export async function login(_: AuthState, form: FormData) { return authenticate('login', form); }
export async function register(_: AuthState, form: FormData) { return authenticate('register', form); }

export async function logout() {
  const rt = (await cookies()).get(REFRESH)?.value;
  if (rt) await api('/auth/logout', { method: 'POST', body: { refresh_token: rt } }).catch(() => {});
  await clearSession();
  redirect('/');
}
