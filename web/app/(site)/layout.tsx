import { SiteFooter, SiteHeader } from '@/components/site';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (<><a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
    <SiteHeader /><main id="main">{children}</main><SiteFooter /></>);
}
