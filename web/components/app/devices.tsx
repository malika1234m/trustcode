import { deactivateDevice } from '@/app/actions/account';
import { fmtDate, fmtTime } from '@/lib/data';

export type Device = { id: string; name: string; platform: string | null; status: string; activated_at: string; last_validated_at: string | null };
export type Devices = { configured: boolean; plan: { id: string; name: string }; offline_grace_days: number; max_devices: number; active_devices: number; items: Device[] };

/** Devices signed in to this account. The extension works without an account; a device appears here after signing in. */
export function DeviceList({ d }: { d: Devices }) {
  const active = d.items.filter((x) => x.status === 'active');
  return (
    <section id="devices" className="card scroll-mt-24 p-6" aria-labelledby="devices-title">
      <h2 id="devices-title" className="text-lg font-semibold">Devices</h2>
      <p className="mt-1 text-sm text-muted">
        {d.active_devices} of {d.max_devices} devices in use. Each one can keep your {d.plan.name} plan for up to {d.offline_grace_days} days without
        an internet connection, then checks it again when it reconnects.
      </p>
      {active.length ? (
        <ul className="mt-4 divide-y divide-line">
          {active.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{x.name}</p>
                <p className="text-xs text-dim">{x.platform ?? 'Unknown system'} · signed in {fmtDate(x.activated_at)} · last checked {x.last_validated_at ? fmtTime(x.last_validated_at) : 'never'}</p>
              </div>
              <form action={deactivateDevice}><input type="hidden" name="id" value={x.id} />
                <button className="min-h-9 rounded-lg border border-line2 px-3 text-xs font-medium hover:bg-card2" aria-label={`Sign out ${x.name}`}>Sign out this device</button></form>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-muted">No devices yet. Sign in from the TrustCode extension in VS Code to add one.</p>}
      {d.items.some((x) => x.status === 'revoked') && <p className="mt-3 text-sm text-warn">A device on this account was blocked by an administrator. Contact support if this is unexpected.</p>}
      <p className="mt-4 text-xs text-dim">Signing out a device turns off its plan the next time it connects. Checks on the Free plan keep working on every device, with or without an account.</p>
    </section>
  );
}
