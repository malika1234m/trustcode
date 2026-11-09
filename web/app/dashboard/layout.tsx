import type { Metadata } from 'next';
import { AppShell } from '@/components/app/shell';

export const metadata: Metadata = { title: { template: '%s · Dashboard · TrustCode', default: 'Dashboard' }, robots: { index: false } };
const NAV: [string, string][] = [['/dashboard', 'Overview'], ['/dashboard/history', 'History'], ['/dashboard/support', 'Support'], ['/dashboard/settings', 'Settings']];

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} base="/dashboard">{children}</AppShell>;
}
