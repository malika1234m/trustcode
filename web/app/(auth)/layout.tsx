import Link from 'next/link';
import { Logo, LogoMark } from '@/components/logo';
import { PanelArt } from '@/components/landing/panel-art';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-bg2 p-12 lg:flex lg:flex-col">
        <div aria-hidden="true" className="glow absolute inset-0" />
        <div aria-hidden="true" className="hatch absolute inset-0 [mask-image:radial-gradient(70%_55%_at_100%_100%,#000,transparent_70%)]" />
        <LogoMark className="pointer-events-none absolute -right-20 -top-16 h-80 w-80 opacity-[.06]" />
        <Link href="/" aria-label="TrustCode home" className="relative inline-flex min-h-11 w-fit items-center"><Logo /></Link>
        <div className="relative flex flex-1 flex-col items-center justify-center gap-10">
          <PanelArt />
          <p className="text-2xl font-semibold">Evidence, not guesses.</p>
        </div>
      </aside>
      <main id="main" className="flex flex-col items-center justify-center px-5 py-12">
        <Link href="/" aria-label="TrustCode home" className="mb-10 inline-flex min-h-11 items-center lg:hidden"><Logo size="lg" /></Link>
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
