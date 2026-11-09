'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { clearSession } from '@/lib/session';

export type Msg = { ok?: string; error?: string; profile?: Record<string, unknown> };
const err = (e: unknown) => ({ error: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.' });
const LEVELS = ['beginner', 'intermediate', 'advanced'];

export async function updateProfile(_: Msg, form: FormData): Promise<Msg> {
  const level = String(form.get('experience_level') ?? '');
  let profile: Record<string, unknown>;
  try {
    profile = await api('/profile', { method: 'PATCH', body: {
      experience_level: LEVELS.includes(level) ? level : undefined,
      store_history: form.get('store_history') === 'on',
      allow_llm: form.get('allow_llm') === 'on',
      adaptive_suggestions: form.get('adaptive_suggestions') === 'on',
    } });
  } catch (e) { return err(e); }
  revalidatePath('/dashboard/settings');
  return { ok: 'Settings saved. VS Code picks them up on the next verification.', profile };
}

export async function deleteAccount(_: Msg, form: FormData): Promise<Msg> {
  if (String(form.get('confirm') ?? '').trim() !== 'DELETE') return { error: 'Type DELETE to confirm.' };
  try { await api('/me/data', { method: 'DELETE' }); } catch (e) { return err(e); }
  await clearSession();
  redirect('/?deleted=1');
}

export async function replyTicket(ticketId: string, _: Msg, form: FormData): Promise<Msg> {
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { error: 'Write a message first.' };
  try { await api(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body: { body: body.slice(0, 5000) } }); }
  catch (e) { return err(e); }
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: 'Sent.' };
}

// ---------------------------------------------------------------- admin (the API enforces the admin role)
export async function adminUserAction(form: FormData) {
  const id = String(form.get('id') ?? '');
  const action = form.get('action') === 'restore' ? 'restore' : 'suspend';
  await api(`/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  revalidatePath('/admin/users');
}

export async function adminTicketUpdate(form: FormData) {
  const id = String(form.get('id') ?? '');
  const status = String(form.get('status') ?? '');
  await api(`/admin/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: {
    status: ['open', 'pending', 'resolved', 'closed'].includes(status) ? status : undefined,
    assign_to_me: form.get('assign') === '1' || undefined,
  } });
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath('/admin/tickets');
}
