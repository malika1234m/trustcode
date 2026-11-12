import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';
import { DOCS } from '@/lib/docs';
import { LEGAL } from '@/lib/legal';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/features', '/how-it-works', '/pricing', '/roadmap', '/docs', '/changelog', '/about', '/contact'];
  return [
    ...pages.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.7 })),
    ...DOCS.map((d) => ({ url: `${SITE_URL}/docs/${d.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
    ...Object.keys(LEGAL).map((s) => ({ url: `${SITE_URL}/legal/${s}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
  ];
}
