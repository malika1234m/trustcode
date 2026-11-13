import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/app/shell';
import { ProfileForm, DeleteAccountForm, type Profile } from '@/components/app/forms';
import { load } from '@/lib/data';
import { api } from '@/lib/api';
import { DeviceList, type Devices } from '@/components/app/devices';

export const metadata: Metadata = { title: 'Settings' };

async function Prefs() {
  const p = await load<Profile>('/profile', '/dashboard/settings');
  return <ProfileForm p={p} />;
}

async function DeviceSection() {
  // Optional section: an API without licensing (or an older API) must not break the settings page.
  const d = await api<Devices>('/licence/devices').catch(() => null);
  return d && (d.configured || d.items.length) ? <DeviceList d={d} /> : null;
}

export default function Settings() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle title="Settings">These are the same settings the VS Code extension uses.</PageTitle>
      <Suspense fallback={<Skeleton h="h-72" />}><Prefs /></Suspense>
      <Suspense fallback={<Skeleton h="h-40" />}><DeviceSection /></Suspense>
      <DeleteAccountForm />
    </div>
  );
}
