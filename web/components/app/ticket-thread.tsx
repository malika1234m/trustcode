import { StatusBadge } from './shell';
import { fmtTime, type Ticket } from '@/lib/data';

export function TicketThread({ t }: { t: Ticket }) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{t.subject}</h1><StatusBadge s={t.status} /></div>
      <p className="mb-6 text-sm text-dim">{t.category} · {t.email} · opened {fmtTime(t.created_at)}</p>
      <ol className="space-y-4">
        {t.messages?.map((m, i) => (
          <li key={i} className={`card p-5 ${m.author === 'staff' ? 'border-brand/40' : ''}`}>
            <p className="mb-2 text-xs text-dim">{m.author === 'staff' ? 'TrustCode support' : 'Customer'} · {fmtTime(m.created_at)}</p>
            <p className="whitespace-pre-wrap text-sm leading-6">{m.body}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
