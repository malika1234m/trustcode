'use server';
import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export type FormState = { ok?: boolean; error?: string; id?: string | null };
const CATEGORIES = ['question', 'bug', 'feature', 'account', 'billing'];

export async function submitTicket(_: FormState, form: FormData): Promise<FormState> {
  const category = String(form.get('category') ?? '');
  const payload = {
    category: CATEGORIES.includes(category) ? category : 'question',
    subject: String(form.get('subject') ?? '').slice(0, 200),
    message: String(form.get('message') ?? '').slice(0, 5000),
    email: String(form.get('email') ?? '').trim() || undefined,
    website: String(form.get('website') ?? ''),   // honeypot
  };
  try {
    const r = await api<{ id: string | null }>('/support/tickets', { method: 'POST', body: payload });
    revalidatePath('/dashboard/support');
    return { ok: true, id: r.id };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Could not send your message. Please try again.' };
  }
}
