'use client';
import { useActionState } from 'react';
import { submitTicket, type FormState } from '@/app/actions/support';
import { CheckCircleIcon } from '@/components/icons';

export function ContactForm({ signedIn = false }: { signedIn?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitTicket, {});
  if (state.ok) {
    return <div role="status" className="card p-8 text-center"><CheckCircleIcon className="mx-auto h-10 w-10 text-ok" /><h2 className="mt-2 text-xl font-semibold">Message received</h2>
      <p className="mt-2 text-muted">We’ll reply by email{signedIn ? ' and in your dashboard' : ''}.</p></div>;
  }
  return (
    <form action={action} className="card p-7">
      {state.error && <p role="alert" className="mb-2 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">{state.error}</p>}
      <label className="label" htmlFor="category">Topic</label>
      <select id="category" name="category" className="input" defaultValue="question">
        <option value="question">General question</option><option value="bug">Report a bug</option><option value="feature">Feature request</option>
        <option value="account">Account issue</option><option value="billing">Billing</option>
      </select>
      {!signedIn && (<><label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" /></>)}
      <label className="label" htmlFor="subject">Subject</label>
      <input id="subject" name="subject" required minLength={3} maxLength={200} className="input" />
      <label className="label" htmlFor="message">Message</label>
      <textarea id="message" name="message" required minLength={10} maxLength={5000} rows={6} className="input" />
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <button type="submit" disabled={pending} className="btn btn-primary mt-6 w-full">{pending ? 'Sending…' : 'Send message'}</button>
      <p className="mt-3 text-xs text-dim">All fields are required. Please don’t include passwords or private source code.</p>
    </form>
  );
}
