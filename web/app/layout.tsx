import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { SITE_URL } from '@/lib/config';
import './globals.css';

const sans = IBM_Plex_Sans({ variable: '--font-plex-sans', subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });
const mono = IBM_Plex_Mono({ variable: '--font-plex-mono', subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'TrustCode: project-wide security checks for AI-written code', template: '%s · TrustCode' },
  description: 'A VS Code extension that checks the code you and your AI coding agents write, on your computer: injection, exposed credentials, hallucinated packages and more. Your code is not uploaded. Free with an account. Evidence for every finding, and a clear list of what was not checked.',
  openGraph: { type: 'website', siteName: 'TrustCode', url: SITE_URL },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0C1322' }, { media: '(prefers-color-scheme: light)', color: '#F6F8FC' }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} min-h-dvh`}>{children}</body>
    </html>
  );
}
