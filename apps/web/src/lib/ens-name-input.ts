import ensDeployment from '../../../../deployments/ens-sepolia.json';

export const paymentNameSuffix = `.${ensDeployment.namespace}`;
const walletAddress = /^0x[\da-f]{40}$/i;

export function editablePaymentName(name: string): string {
  const trimmed = name.trim();
  const label = trimmed.slice(0, -paymentNameSuffix.length);
  return trimmed.toLowerCase().endsWith(paymentNameSuffix) && label && !label.includes('.') && !walletAddress.test(label) ? label : trimmed;
}

export function paymentNameInput(name: string) {
  const trimmed = name.trim();
  const showSuffix = !trimmed.includes('.') && !walletAddress.test(trimmed);
  return { showSuffix, completeName: trimmed && showSuffix ? `${trimmed}${paymentNameSuffix}` : trimmed };
}
