'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { login, register, type AuthState } from '@/app/actions/auth';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function AuthForm({ mode, next }: { mode: 'login' | 'register'; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === 'login' ? login : register, {});
  const isLogin = mode === 'login';
  const [show, setShow] = useState(false);
  const [emailBad, setEmailBad] = useState(false);
  const [pwLen, setPwLen] = useState(0);
  const [caps, setCaps] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.error) alertRef.current?.focus(); }, [state]);   // move focus to the server's answer
  const q = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <>
      <h1 className="mb-6 text-[1.9rem] font-semibold leading-tight">{isLogin ? 'Welcome back' : 'Create your account'}</h1>

      <nav aria-label="Account" className="mb-5 grid grid-cols-2 rounded-xl border border-line bg-bg2 p-1">
        {([['login', 'Sign in'], ['register', 'Create account']] as const).map(([m, l]) => (
          <Link key={m} href={`/${m}${q}`} aria-current={m === mode ? 'page' : undefined}
                className={`flex min-h-10 items-center justify-center rounded-lg text-[15px] font-medium transition-colors ${m === mode ? 'bg-card text-fg shadow-[0_0_0_1px_var(--border-2)]' : 'text-muted hover:text-fg'}`}>{l}</Link>
        ))}
      </nav>

      <form action={action}>
        {state.error && <p ref={alertRef} tabIndex={-1} role="alert" className="mb-1 rounded-lg border border-err/40 bg-err/10 px-3 py-2.5 text-[15px] text-err outline-none">{state.error}</p>}
        <input type="hidden" name="next" value={next ?? ''} />

        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" defaultValue={state.email} autoFocus={!state.email}
               aria-invalid={emailBad} aria-describedby={emailBad ? 'email-err' : undefined} className="input"
               onBlur={(e) => setEmailBad(Boolean(e.currentTarget.value) && !EMAIL.test(e.currentTarget.value))}
               onChange={(e) => { if (emailBad && EMAIL.test(e.currentTarget.value)) setEmailBad(false); }} />
        {emailBad && <p id="email-err" className="mt-1.5 text-[13px] text-err">Enter an email address like name@example.com.</p>}

        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">Password</label>
          {isLogin && <Link href="/contact" className="text-[13px] text-brand hover:underline">Forgot password?</Link>}
        </div>
        <div className="relative">
          <input id="password" name="password" type={show ? 'text' : 'password'} required minLength={isLogin ? 1 : 10} autoFocus={Boolean(state.email)}
                 autoComplete={isLogin ? 'current-password' : 'new-password'} aria-describedby={[!isLogin && 'pw-help', caps && 'caps'].filter(Boolean).join(' ') || undefined}
                 className="input pr-12" onChange={(e) => setPwLen(e.currentTarget.value.length)}
                 onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))} onBlur={() => setCaps(false)} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-dim hover:text-fg">
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {!isLogin && (
          <p id="pw-help" aria-live="polite" className={`mt-1.5 text-[13px] ${pwLen >= 10 ? 'text-ok' : 'text-dim'}`}>
            {pwLen === 0 ? 'At least 10 characters.' : pwLen >= 10 ? 'Length looks good.' : `${10 - pwLen} more character${10 - pwLen === 1 ? '' : 's'} needed.`}
          </p>
        )}
        {caps && <p id="caps" className="mt-1.5 text-[13px] text-warn">Caps Lock is on.</p>}

        {!isLogin && (
          <label className="mt-5 flex items-start gap-3 text-sm text-muted">
            <input type="checkbox" name="terms" required className="mt-0.5" />
            <span>I agree to the <Link href="/legal/terms" className="text-brand underline-offset-2 hover:underline">Terms</Link> and <Link href="/legal/privacy" className="text-brand underline-offset-2 hover:underline">Privacy Policy</Link>.</span>
          </label>
        )}

        <button type="submit" disabled={pending} className="btn btn-neon mt-6 w-full">
          {pending ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>

    </>
  );
}
