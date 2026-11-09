import type { Metadata } from 'next';
import { AppShell } from '@/components/app/shell';

export const metadata: Metadata = { title: { template: '%s · Admin · TrustCode', default: 'Admin' }, robots: { index: false, follow: false } };
const NAV: [string, string][] = [['/admin', 'Overview'], ['/admin/users', 'Users'], ['/admin/tickets', 'Tickets'], ['/admin/audit', 'Audit log'], ['/dashboard', '← My dashboard']];

// Every page here reads admin-only API endpoints; the API answers 403 for non-admins and the page renders 404.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} base="/admin">{children}</AppShell>;
}
