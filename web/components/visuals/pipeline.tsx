import { CodeIcon, EyeIcon, RocketIcon, ShieldIcon } from '@/components/icons';
import { StatusBadge } from '@/components/landing/badges';
import type { Status } from '@/lib/capabilities';

// Illustration: code → scan → review → deploy, with a beam travelling along the connectors.
// A step whose capability is not available yet is drawn dashed and labelled.
const STEPS: { label: string; note: string; icon: (p: { className?: string }) => React.ReactNode; status: Status; tone: string }[] = [
  { label: 'Code', note: 'Changes tracked', icon: CodeIcon, status: 'available', tone: 'from-[#4F7BFF] to-[#6C6BFF]' },
  { label: 'Scan', note: 'Every changed file', icon: ShieldIcon, status: 'available', tone: 'from-[#6C6BFF] to-[#A97CFF]' },
  { label: 'Review', note: 'Evidence at the line', icon: EyeIcon, status: 'available', tone: 'from-[#38E1FF] to-[#4F7BFF]' },
  { label: 'Deploy', note: 'Hooks, CI, policy', icon: RocketIcon, status: 'available', tone: 'from-[#4FD1B5] to-[#38E1FF]' },
];

export function Pipeline() {
  return (
    <ol className="relative grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4 sm:gap-4">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const live = s.status === 'available';
        return (
          <li key={s.label} className="relative flex flex-col items-center text-center">
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className={`absolute left-[calc(50%+3rem)] right-[calc(-50%+3rem)] top-10 hidden h-[2px] rounded-full sm:block ${STEPS[i + 1].status === 'available' ? 'beam' : 'bg-[repeating-linear-gradient(90deg,var(--border-2)_0_6px,transparent_6px_12px)]'}`} />
            )}
            <span className={`relative flex h-20 w-20 items-center justify-center rounded-2xl ${live
              ? `bg-gradient-to-br ${s.tone} shadow-[0_0_40px_-6px_rgba(120,110,255,.8)]`
              : 'border-2 border-dashed border-line2 bg-card/40'}`}>
              {live && <span aria-hidden="true" className="pulse-soft absolute -inset-2 rounded-[22px] border border-white/10" style={{ animationDelay: `${i * 0.4}s` }} />}
              <Icon className={`h-9 w-9 ${live ? 'text-white' : 'text-dim'}`} />
            </span>
            <h3 className="mt-5 text-lg font-semibold">{s.label}</h3>
            <p className="mt-0.5 text-sm text-muted">{s.note}</p>
            <StatusBadge status={s.status} className="mt-3" />
          </li>
        );
      })}
    </ol>
  );
}
