import { STATUS_HELP, STATUS_LABEL, statusOf, type Status } from '@/lib/capabilities';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function StatusBadge({ status, className = '' }: { status: Status; className?: string }) {
  return <span className={`status status-${status} ${className}`} title={STATUS_HELP[status]}>{STATUS_LABEL[status]}</span>;
}

/** Badge for a named roadmap capability, so a section can never drift from the roadmap. */
export function CapabilityBadge({ name, className }: { name: string; className?: string }) {
  return <StatusBadge status={statusOf(name)} className={className} />;
}

export function SeverityLabel({ severity, className = '' }: { severity: Severity; className?: string }) {
  return <span className={`sev sev-${severity} ${className}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function DemoTag({ className = '' }: { className?: string }) {
  return <span className={`status status-planned !text-[0.7rem] ${className}`}>Demonstration data</span>;
}
