'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const p = usePathname();
  const active = exact ? p === href : p === href || p.startsWith(href + '/');
  return <Link href={href} aria-current={active ? 'page' : undefined}
    className={`flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${active ? 'bg-card2 font-medium text-fg' : 'text-muted hover:bg-card hover:text-fg'}`}>{children}</Link>;
}
