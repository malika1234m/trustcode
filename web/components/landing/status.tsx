import { AlertIcon, CheckIcon, HelpIcon, MinusIcon } from '@/components/icons';
import type { Status } from '@/lib/scenarios';

export const STATUS_LABEL: Record<Status, string> = { clean: 'No findings', issue: 'Issue detected', not_tested: 'Not tested', review: 'Needs your review' };

export function StatusIcon({ s, className = 'h-4 w-4' }: { s: Status; className?: string }) {
  if (s === 'clean') return <CheckIcon className={`${className} text-ok`} label={STATUS_LABEL[s]} />;
  if (s === 'issue') return <AlertIcon className={`${className} text-warn`} label={STATUS_LABEL[s]} />;
  if (s === 'review') return <HelpIcon className={`${className} text-info`} label={STATUS_LABEL[s]} />;
  return <MinusIcon className={`${className} text-dim`} label={STATUS_LABEL[s]} />;
}
