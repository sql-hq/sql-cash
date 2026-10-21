export class OrganizationAccountError extends Error {
  constructor(public readonly title: string, message: string) { super(message); this.name = 'OrganizationAccountError'; }
}

export async function organizationResponseError(response: Response): Promise<OrganizationAccountError> {
  const value: unknown = await response.json().catch(() => null);
  const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
  if (code === 'NULL_ORGANIZATION_FORBIDDEN') return new OrganizationAccountError('Organization access required',
    'You are signed in with an account that is not an approver for this organization. Sign out and sign in with the organization owner’s email. Your saved setup stays on this device.');
  if (response.status === 401) return new OrganizationAccountError('Sign in again',
    'Your sign-in could not be verified. Sign out and sign in again with the organization owner’s email, then check the link.');
  if (response.status === 429) return new OrganizationAccountError('Please wait before checking again',
    'Too many organization checks were requested. Wait one minute, then check the link again.');
  if (code === 'NULL_PRIVY_CONTROL_MISMATCH') return new OrganizationAccountError('Organization wallet needs attention',
    'The organization wallet’s approval controls do not match its configuration. Ask the organization administrator to check the wallet setup.');
  if (code === 'NULL_ORIGIN_REJECTED') return new OrganizationAccountError('Organization access unavailable here',
    'This website address is not enabled for organization approvals. Open the organization’s configured production link.');
  return new OrganizationAccountError('Organization service unavailable',
    'The organization service could not verify its approval wallet. Try checking the link again shortly. Your saved setup is still on this device.');
}
