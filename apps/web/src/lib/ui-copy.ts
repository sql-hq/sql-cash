import type { Distribution } from './store';

const paymentStatuses: Record<Distribution['status'], string> = {
  Draft: 'Draft',
  Prepared: 'Ready to send',
  'Published locally': 'Sent in practice',
  Confirmed: 'Sent',
};

// Keep protocol and saved-state values stable; translate only their UI labels.
export function paymentStatusLabel(status: Distribution['status']): string {
  return paymentStatuses[status];
}
