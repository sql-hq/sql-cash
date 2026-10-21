import { config } from './config';
import { organizationResponseError } from './organization-error';

const configured = import.meta.env.VITE_ORGANIZATION_URL as string | undefined;
export const organizationEndpoint = import.meta.env.PROD && (!configured || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured))
  ? window.location.origin : configured;

export async function loadOrganizationAddress(getAccessToken: () => Promise<string | null>): Promise<string> {
  if (!organizationEndpoint) throw new Error('Organization approval is not configured. Ask your administrator to finish setup.');
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in as an organization approver to verify this account.');
  const response = await fetch(`${organizationEndpoint.replace(/\/$/, '')}/api/organization/config`, {
    headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await organizationResponseError(response);
  const value = await response.json();
  if (value.chainId !== config.chainId.toString() || value.poolAddress?.toLowerCase() !== config.poolAddress?.toLowerCase()
    || !/^0x[0-9a-fA-F]{40}$/.test(value.walletAddress) || /^0x0{40}$/i.test(value.walletAddress)) throw new Error('The organization account does not match this network.');
  return value.walletAddress;
}
