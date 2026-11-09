import { NextRequest, NextResponse } from 'next/server';

const API_URL = (process.env.TRUSTCODE_API_URL ?? 'https://trustcode-api.vercel.app').replace(/\/$/, '');
const secure = process.env.NODE_ENV === 'production';

function expiresSoon(jwt: string | undefined): boolean {
  if (!jwt) return true;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

/** Keeps signed-in sessions alive (rotating refresh token) and guards private areas. */
export async function proxy(req: NextRequest) {
  const access = req.cookies.get('tc_at')?.value;
  const refresh = req.cookies.get('tc_rt')?.value;
  const login = new URL(`/login?next=${encodeURIComponent(req.nextUrl.pathname)}`, req.url);
  if (!expiresSoon(access)) return NextResponse.next();
  if (!refresh) return NextResponse.redirect(login);
  const r = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }), cache: 'no-store',
  }).catch(() => null);
  if (!r || !r.ok) {
    const res = NextResponse.redirect(login);
    res.cookies.delete('tc_at');
    res.cookies.delete('tc_rt');
    return res;
  }
  const t = await r.json();
  // Make the fresh tokens visible to this request's server components (request cookies) ...
  req.cookies.set('tc_at', t.access_token);
  req.cookies.set('tc_rt', t.refresh_token);
  const res = NextResponse.next({ request: { headers: new Headers(req.headers) } });
  // ... and persist them in the browser (httpOnly response cookies).
  const opts = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  res.cookies.set('tc_at', t.access_token, { ...opts, maxAge: t.expires_in });
  res.cookies.set('tc_rt', t.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 7 });
  return res;
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };
