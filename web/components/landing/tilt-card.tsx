'use client';
import Link from 'next/link';
import { useRef } from 'react';

/** Card with perspective tilt and a glow that follows the pointer. Static on touch screens and with reduced motion. */
export function TiltCard({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--gx', `${x * 100}%`); el.style.setProperty('--gy', `${y * 100}%`);
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 8}deg) rotateY(${(x - 0.5) * 10}deg) translateZ(0)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <Link ref={ref} href={href} onPointerMove={onMove} onPointerLeave={reset}
          className={`tilt-card group relative block overflow-hidden rounded-2xl border border-white/[.07] bg-[linear-gradient(160deg,rgba(24,35,58,.9),rgba(12,19,34,.9))] p-5 transition-[transform,border-color,box-shadow] duration-200 ease-out hover:border-brand/50 hover:shadow-[0_20px_60px_-20px_rgba(91,140,255,.45)] ${className}`}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 bg-[radial-gradient(300px_circle_at_var(--gx,50%)_var(--gy,50%),rgba(91,140,255,.18),transparent_60%)]" />
      <span className="relative block">{children}</span>
    </Link>
  );
}
