import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/forms/auth-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

async function Form({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-card" aria-busy="true" />}><Form searchParams={searchParams} /></Suspense>
    </>
  );
}
