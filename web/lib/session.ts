import 'server-only';
import { cookies } from 'next/headers';

export const ACCESS = 'tc_at';
export const REFRESH = 'tc_rt';
const base = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };

export async function getAccessToken() {
  return (await cookies()).get(ACCESS)?.value;
}

export async function setSession(t: { access_token: string; refresh_token?: string | null; expires_in: number }) {
  const c = await cookies();
  c.set(ACCESS, t.access_token, { ...base, maxAge: t.expires_in });
  if (t.refresh_token) c.set(REFRESH, t.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export async function clearSession() {
  const c = await cookies();
  c.delete(ACCESS);
  c.delete(REFRESH);
}
