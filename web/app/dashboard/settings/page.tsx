import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/app/shell';
import { ProfileForm, DeleteAccountForm, type Profile } from '@/components/app/forms';
import { load } from '@/lib/data';

export const metadata: Metadata = { title: 'Settings' };

async function Prefs() {
  const p = await load<Profile>('/profile', '/dashboard/settings');
  return <ProfileForm p={p} />;
}

export default function Settings() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle title="Settings">These are the same settings the VS Code extension uses.</PageTitle>
      <Suspense fallback={<Skeleton h="h-72" />}><Prefs /></Suspense>
      <DeleteAccountForm />
    </div>
  );
}
