'use client';
import { useEffect, useRef } from 'react';

/** Marks children with data-shown when scrolled into view. Used once, for the journey timeline. */
export function RevealGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const items = ref.current ? [...ref.current.querySelectorAll<HTMLElement>('[data-reveal]')] : [];
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = ''; io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -12% 0px' });
    items.forEach((el, i) => { el.style.transitionDelay = `${Math.min(i, 5) * 60}ms`; io.observe(el); });
    return () => io.disconnect();
  }, []);
  return <ol ref={ref} className={className}>{children}</ol>;
}
