'use client';
import { useActionState } from 'react';
import { updateProfile, deleteAccount, replyTicket, type Msg } from '@/app/actions/account';

function Note({ s }: { s: Msg }) {
  if (s.error) return <p role="alert" className="mt-3 text-sm text-err">{s.error}</p>;
  if (s.ok) return <p role="status" className="mt-3 text-sm text-ok">{s.ok}</p>;
  return null;
}

export type Profile = { experience_level: string; store_history: boolean; allow_llm: boolean; adaptive_suggestions: boolean; llm_available: boolean };

export function ProfileForm({ p: initial }: { p: Profile }) {
  const [s, action, pending] = useActionState<Msg, FormData>(updateProfile, {});
  const p = (s.profile as Profile | undefined) ?? initial;   // React resets the form after an action; show what was saved
  const toggles: [keyof Profile, string, string][] = [
    ['store_history', 'Keep verification history (30 days)', 'Off: results are deleted after 24 hours.'],
    ['adaptive_suggestions', 'Suggest a different explanation level', 'Based on your recorded decisions; never changes the level by itself.'],
    ['allow_llm', 'AI-worded explanations', p.llm_available ? 'Sends finding text (not your code) to an AI model for wording.' : 'Not available on this server.'],
  ];
  return (
    <form action={action} className="card p-6" key={JSON.stringify(p)}>
      <h2 className="font-semibold">Preferences</h2>
      <label className="label" htmlFor="lvl">Explanation level</label>
      <select id="lvl" name="experience_level" defaultValue={p.experience_level} className="input max-w-xs">
        <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
      </select>
      <div className="mt-5 space-y-4">
        {toggles.map(([k, t, d]) => (
          <label key={k} className="flex items-start gap-3">
            <input type="checkbox" name={k} defaultChecked={Boolean(p[k])} disabled={k === 'allow_llm' && !p.llm_available} className="mt-1" />
            <span><span className="block text-sm font-medium">{t}</span><span className="text-xs text-dim">{d}</span></span>
          </label>
        ))}
      </div>
      <button disabled={pending} className="btn btn-primary mt-6">{pending ? 'Saving…' : 'Save'}</button>
      <Note s={s} />
    </form>
  );
}

export function DeleteAccountForm() {
  const [s, action, pending] = useActionState<Msg, FormData>(deleteAccount, {});
  return (
    <form action={action} className="card border-err/40 p-6">
      <h2 className="font-semibold text-err">Delete account</h2>
      <p className="mt-1 text-sm text-muted">Permanently deletes your account, verification history, decisions and feedback. This cannot be undone.</p>
      <label className="label" htmlFor="confirm">Type DELETE to confirm</label>
      <input id="confirm" name="confirm" autoComplete="off" className="input max-w-xs" />
      <button disabled={pending} className="btn mt-4 border border-err/50 text-err hover:bg-err/10">{pending ? 'Deleting…' : 'Delete my account'}</button>
      <Note s={s} />
    </form>
  );
}

export function ReplyForm({ id, closed }: { id: string; closed: boolean }) {
  const [s, action, pending] = useActionState<Msg, FormData>(replyTicket.bind(null, id), {});
  if (closed) return <p className="text-sm text-muted">This ticket is closed. Open a new one if you need more help.</p>;
  return (
    <form action={action} className="card p-5">
      <label className="label mt-0" htmlFor="body">Reply</label>
      <textarea id="body" name="body" rows={4} maxLength={5000} required className="input" />
      <button disabled={pending} className="btn btn-primary mt-4">{pending ? 'Sending…' : 'Send reply'}</button>
      <Note s={s} />
    </form>
  );
}
