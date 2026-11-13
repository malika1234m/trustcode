'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Logo } from './logo';
import { INSTALL_URL } from '@/lib/config';

export const NAV = [
  { label: 'Features', href: '/#features', section: 'features' },
  { label: 'How it works', href: '/#how-it-works', section: 'how-it-works' },
  { label: 'Security checks', href: '/#security', section: 'security' },
  { label: 'Documentation', href: '/docs' },
  { label: 'Roadmap', href: '/roadmap' },
  { label: 'Pricing', href: '/pricing', section: 'pricing' },
] as const;

function useActive(pathname: string) {
  const [section, setSection] = useState<string | null>(null);
  useEffect(() => {
    if (pathname !== '/') return;
    const ids = NAV.flatMap((n) => ('section' in n ? [n.section] : []));
    const update = () => {
      const line = window.innerHeight * 0.4;   // the section crossing 40% of the viewport is "current"
      const hit = ids.find((id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.top <= line && r.bottom > line; });
      setSection(hit ?? null);
    };
    update();
    const late = window.setTimeout(update, 350);   // after hash jumps and font swaps settle
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('hashchange', update);
    return () => { window.clearTimeout(late); window.removeEventListener('scroll', update); window.removeEventListener('hashchange', update); };
  }, [pathname]);
  return (href: string, sec?: string) => {
    if (pathname === '/') return Boolean(sec) && section === sec;
    return !href.startsWith('/#') && (pathname === href || pathname.startsWith(href + '/'));
  };
}

export function SiteHeaderClient() {
  const pathname = usePathname();
  const isActive = useActive(pathname);
  const [scrolled, setScrolled] = useState(false);
  // The drawer belongs to the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof v === 'function' ? v(open) : v) ? pathname : null);
  const [hover, setHover] = useState<number | null>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const navRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const activeIndex = NAV.findIndex((n) => isActive(n.href, 'section' in n ? n.section : undefined));
  const target = hover ?? (activeIndex >= 0 ? activeIndex : null);
  const measure = useCallback(() => {
    const el = target === null ? null : links.current[target];
    const nav = navRef.current;
    if (!el || !nav) return setBar(null);
    setBar({ x: el.offsetLeft, w: el.offsetWidth });
  }, [target]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [measure]);

  // Drawer: close on navigation and Escape; lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header className={`sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-200 ${scrolled || open ? 'border-b border-line bg-bg/80 backdrop-blur-xl' : 'border-b border-transparent bg-transparent'}`}>
      <div className="mx-auto flex h-16 wrap items-center justify-between gap-4">
        <Link href="/" aria-label="TrustCode home" className="inline-flex min-h-11 items-center"><Logo /></Link>

        <div ref={navRef} className="relative hidden lg:block" onMouseLeave={() => setHover(null)}>
          <nav aria-label="Main" className="flex items-center gap-1 text-[0.94rem]">
            {NAV.map((n, i) => {
              const active = i === activeIndex;
              return (
                <Link key={n.href} href={n.href} ref={(el) => { links.current[i] = el; }} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                      aria-current={active ? (pathname === '/' ? 'location' : 'page') : undefined}
                      className={`relative inline-flex min-h-11 items-center px-3 transition-colors ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}>{n.label}</Link>
              );
            })}
          </nav>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-0 h-0.5 w-[100px] origin-left rounded-full bg-brand transition-[transform,opacity] duration-300 ease-out"
                style={{ transform: bar ? `translateX(${bar.x + 12}px) scaleX(${(bar.w - 24) / 100})` : undefined, opacity: bar ? 1 : 0 }} />
        </div>

        <div className="flex items-center gap-2">
          <Link href="/login" className="inline-flex min-h-10 items-center px-3 text-sm text-muted hover:text-fg max-sm:!hidden">Sign in</Link>
          <a href={INSTALL_URL} className="btn btn-neon !min-h-10 !px-4 !py-2 text-sm">Download</a>
          <button ref={menuBtn} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-fg hover:bg-card lg:hidden">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d={open ? 'M6 6l12 12' : 'M4 7h16'} className="transition-all duration-200" />
              <path d={open ? 'M18 6L6 18' : 'M4 17h16'} className="transition-all duration-200" />
            </svg>
          </button>
        </div>
      </div>

      <div id="mobile-nav" hidden={!open} className="border-t border-line bg-bg lg:hidden">
        <nav aria-label="Main (mobile)" className="mx-auto flex h-[calc(100dvh-4rem)] wrap flex-col overflow-y-auto pb-8 pt-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex min-h-14 items-center border-b border-line text-lg text-fg">{n.label}</Link>
          ))}
          <div className="mt-6 grid gap-3">
            <a href={INSTALL_URL} className="btn btn-primary w-full">Download for VS Code</a>
            <Link href="/login" onClick={() => setOpen(false)} className="btn btn-ghost w-full">Sign in</Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
