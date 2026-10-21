import { parsePrivacyProfile } from '@null-protocol/crypto';
import { encodePacked, getAddress, keccak256, parseAbi, stringToHex, toHex, zeroAddress, zeroHash, type Address, type Hex, type PublicClient } from 'viem';
import { namehash, normalize, packetToBytes } from 'viem/ens';

/** NULL-specific ENSIP-5 key. Contains public spending/viewing keys, never recovery secrets. */
export const PAYMENT_RECORD = 'null.paymentProfile';
export const ENS_CHAIN_ID = 11155111;
// Official ENS Sepolia beta deployments, pinned to their source revision. Read resolution
// deliberately uses viem's canonical Universal Resolver proxy, not an implementation address.
export const ENS_V2 = {
  factory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
  resolverImplementation: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e',
  sourceRevision: '97a57293f3b4279d94b571e678edb53ce62638f4',
} as const;
export const resolverAbi = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function text(bytes32 node, string key) view returns (string)',
  'function getAlias(bytes fromName) view returns (bytes)',
  'function authorizeTextRoles(bytes toName, string key, address account, bool grant) returns (bool)',
  'function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)',
]);
const factoryAbi = parseAbi(['function verifyContract(address proxy) view returns (address implementation)']);
const hierarchyAbi = parseAbi([
  'function findOwner(bytes name) view returns (address)',
  'function findParentRegistry(bytes name) view returns (address)',
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
]);
export class PaymentNameError extends Error {
  constructor(public readonly code: 'invalid' | 'missing' | 'profile' | 'network' | 'changed' | 'unsupported' | 'permission' | 'alias', message: string) { super(message); this.name = 'PaymentNameError'; }
}
export type PaymentNameSnapshot = {
  name: string; profile: string; fingerprint: Hex; resolver: Address; owner: Address; chainId: typeof ENS_CHAIN_ID; blockNumber: string;
};
export function normalizePaymentName(input: string): string {
  try {
    if (input.length > 512 || input.trim().startsWith('0x') || input.includes(':') || input.includes('/') || input.includes('@')) throw new Error();
    const name = normalize(input.trim());
    if (!name.includes('.') || packetToBytes(name).length > 255) throw new Error();
    return name;
  } catch { throw new PaymentNameError('invalid', 'Enter a complete ENS name, such as your-name.eth. Wallet addresses do not work here.'); }
}
export function canonicalPaymentProfile(value: string): string {
  try { return parsePrivacyProfile(value.trim()).stealthMetaAddress; }
  catch { throw new PaymentNameError('profile', 'This name does not contain a valid NULL Payment ID. Ask the recipient to link their Payment ID in NULL.'); }
}
export function profileFingerprint(profile: string): Hex { return keccak256(stringToHex(canonicalPaymentProfile(profile))); }
export function paymentDestination(input: string): { kind: 'profile'; profile: string } | { kind: 'name'; name: string } {
  return input.trim().startsWith('st:eth:') ? { kind: 'profile', profile: canonicalPaymentProfile(input) } : { kind: 'name', name: normalizePaymentName(input) };
}
/** Required receiving identity for the live NULL application. Raw IDs remain a crypto format. */
export function requiredPaymentNames(rows: readonly { destination?: string; profile: string; paymentName?: PaymentNameSnapshot }[]): PaymentNameSnapshot[] {
  if (rows.length < 1 || rows.length > 8) throw new PaymentNameError('invalid', 'Add between one and eight ENS recipients.');
  return rows.map((row, index) => {
    const destination = paymentDestination(row.destination ?? row.profile);
    if (destination.kind !== 'name') throw new PaymentNameError('missing', `Recipient ${index + 1} needs an ENS payment name. Ask them to link their Payment ID in their NULL inbox.`);
    const snapshot = row.paymentName;
    if (!snapshot || snapshot.name !== destination.name || snapshot.chainId !== ENS_CHAIN_ID || snapshot.profile !== canonicalPaymentProfile(row.profile) || snapshot.fingerprint !== profileFingerprint(row.profile)) {
      throw new PaymentNameError('changed', `Check and confirm the ENS name for recipient ${index + 1} before preparing this payment.`);
    }
    return { ...snapshot };
  });
}
/** Count is the compiler's real recipient count, never the caller's filtered name count. */
export async function recheckRequiredPaymentNames(client: PublicClient, snapshots: readonly PaymentNameSnapshot[] | undefined, recipientCount: number): Promise<void> {
  if (!Number.isInteger(recipientCount) || recipientCount < 1 || recipientCount > 8 || !snapshots || snapshots.length !== recipientCount) throw new PaymentNameError('missing', 'Every recipient needs a confirmed ENS payment name. Prepare this payment again.');
  requiredPaymentNames(snapshots.map(paymentName => ({ destination: paymentName.name, profile: paymentName.profile, paymentName })));
  await recheckPaymentNames(client, snapshots);
  await Promise.all([...new Set(snapshots.map(snapshot => snapshot.resolver))].map(resolver => assertPermissionedResolver(client, resolver)));
}
export async function assertEnsChain(client: PublicClient): Promise<void> {
  if (client.chain?.id !== ENS_CHAIN_ID || await client.getChainId() !== ENS_CHAIN_ID) throw new PaymentNameError('network', 'Payment names use Sepolia. Switch your wallet and connection to Sepolia.');
}
export async function inspectPaymentName(client: PublicClient, input: string) {
  const name = normalizePaymentName(input);
  await assertEnsChain(client);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  try {
    const universal = client.chain!.contracts!.ensUniversalResolver!.address;
    const encodedName = toHex(packetToBytes(name));
    const [resolver, value, owner, parent] = await Promise.all([
      client.getEnsResolver({ name, blockNumber }),
      client.getEnsText({ name, key: PAYMENT_RECORD, blockNumber }),
      client.readContract({ address: universal, abi: hierarchyAbi, functionName: 'findOwner', args: [encodedName], blockNumber }),
      client.readContract({ address: universal, abi: hierarchyAbi, functionName: 'findParentRegistry', args: [encodedName], blockNumber }),
    ]);
    if (!resolver || resolver === zeroAddress) throw new PaymentNameError('missing', 'This name has no active resolver on Sepolia. Check its spelling, registration and expiry in ENS.');
    if (parent !== zeroAddress) {
      const [state, block] = await Promise.all([
        client.readContract({ address: parent, abi: hierarchyAbi, functionName: 'getState', args: [BigInt(keccak256(stringToHex(name.split('.')[0])))], blockNumber }),
        client.getBlock({ blockNumber }),
      ]);
      // A parent's wildcard resolver can still contain an expired child's old record.
      // Do not let that stale record become a valid payment destination.
      if (state.expiry !== 0n && state.expiry <= block.timestamp) throw new PaymentNameError('missing', 'This payment name has expired. Ask the recipient to renew it before paying.');
    }
    return { name, resolver, value, owner, chainId: ENS_CHAIN_ID, blockNumber: blockNumber.toString() } as const;
  } catch (error) {
    if (error instanceof PaymentNameError) throw error;
    throw new PaymentNameError('network', 'The ENS lookup could not be completed. Check your connection and try again. Nothing has been sent.');
  }
}
export async function resolvePaymentName(client: PublicClient, input: string): Promise<PaymentNameSnapshot> {
  const result = await inspectPaymentName(client, input);
  if (!result.value) throw new PaymentNameError('missing', 'This name has no NULL Payment ID on Sepolia. Ask the recipient to link it first.');
  const profile = canonicalPaymentProfile(result.value);
  return { name: result.name, profile, fingerprint: profileFingerprint(profile), resolver: result.resolver, owner: result.owner, chainId: ENS_CHAIN_ID, blockNumber: result.blockNumber };
}
/** Never silently accept a changed destination, including a changed resolver with identical keys. */
export function samePaymentDestination(previous: PaymentNameSnapshot, current: PaymentNameSnapshot): boolean {
  return previous.chainId === current.chainId && previous.name === current.name && previous.profile === current.profile && previous.fingerprint === current.fingerprint && previous.resolver.toLowerCase() === current.resolver.toLowerCase() && previous.owner.toLowerCase() === current.owner.toLowerCase();
}
export async function recheckPaymentNames(client: PublicClient, snapshots: readonly PaymentNameSnapshot[]): Promise<void> {
  if (snapshots.length > 8) throw new PaymentNameError('invalid', 'Check at most eight recipients per payment.');
  await Promise.all(snapshots.map(async previous => {
    const current = await resolvePaymentName(client, previous.name);
    if (!samePaymentDestination(previous, current)) throw new PaymentNameError('changed', `${previous.name} has changed since you checked it. Confirm the new Payment ID with the recipient, then prepare this payment again.`);
  }));
}
export async function assertPermissionedResolver(client: PublicClient, resolver: Address): Promise<void> {
  try {
    const implementation = await client.readContract({ address: ENS_V2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [resolver] });
    if (implementation.toLowerCase() !== ENS_V2.resolverImplementation) throw new Error();
  } catch { throw new PaymentNameError('unsupported', 'This name does not use the supported ENSv2 Permissioned Resolver. Set up its resolver in the ENS Sepolia app, then check again.'); }
}
export async function prepareProfileWrite(client: PublicClient, input: string, profileInput: string, account: Address, expectedResolver: Address) {
  const profile = canonicalPaymentProfile(profileInput);
  const current = await inspectPaymentName(client, input);
  if (current.resolver.toLowerCase() !== expectedResolver.toLowerCase()) throw new PaymentNameError('changed', 'This name’s resolver changed. Check the name again before publishing.');
  await assertPermissionedResolver(client, current.resolver);
  const alias = await client.readContract({ address: current.resolver, abi: resolverAbi, functionName: 'getAlias', args: [toHex(packetToBytes(current.name))] });
  if (alias !== '0x') throw new PaymentNameError('alias', 'This is an alias. Publish using the original ENS name, then check this alias again.');
  // An alias resolves at a different node. Editing its empty local record would not
  // change what payers receive, so require the canonical name for record writes.
  const direct = await client.readContract({ address: current.resolver, abi: resolverAbi, functionName: 'text', args: [namehash(current.name), PAYMENT_RECORD] });
  if ((current.value || '') !== direct) throw new PaymentNameError('alias', 'This is an alias. Publish using the original ENS name, then check this alias again.');
  try {
    return await client.simulateContract({ address: current.resolver, abi: resolverAbi, functionName: 'setText', args: [namehash(current.name), PAYMENT_RECORD, profile], account: getAddress(account) });
  } catch { throw new PaymentNameError('permission', 'This wallet cannot update the Payment ID for this name. Use its resolver owner or a wallet with permission for the NULL payment record.'); }
}
export async function preparePaymentDelegate(client: PublicClient, input: string, editor: Address, grant: boolean, account: Address, expectedResolver: Address) {
  if (getAddress(editor) === zeroAddress || getAddress(editor) === getAddress(account)) throw new PaymentNameError('invalid', 'Choose a different wallet to manage this payment record.');
  const current = await inspectPaymentName(client, input);
  if (current.resolver.toLowerCase() !== expectedResolver.toLowerCase()) throw new PaymentNameError('changed', 'This name’s resolver changed. Check the name again before changing access.');
  await assertPermissionedResolver(client, current.resolver);
  try {
    return await client.simulateContract({ address: current.resolver, abi: resolverAbi, functionName: 'authorizeTextRoles', args: [toHex(packetToBytes(current.name)), PAYMENT_RECORD, getAddress(editor), grant], account: getAddress(account) });
  } catch { throw new PaymentNameError('permission', 'This wallet cannot change record permissions. Connect the resolver administrator’s wallet and try again.'); }
}
export async function paymentEditorAccess(client: PublicClient, input: string, editor: Address) {
  const current = await inspectPaymentName(client, input);
  await assertPermissionedResolver(client, current.resolver);
  return textEditorAccess(client, current, editor, PAYMENT_RECORD);
}
async function textEditorAccess(client: PublicClient, current: Awaited<ReturnType<typeof inspectPaymentName>>, editor: Address, key: string) {
  const node = namehash(current.name), part = keccak256(stringToHex(key));
  const resource = (a: Hex, b: Hex) => BigInt(keccak256(encodePacked(['bytes32', 'bytes32'], [a, b])));
  const resources = [0n, resource(zeroHash, part), resource(node, zeroHash), resource(node, part)];
  const rights = await Promise.all(resources.map(value => client.readContract({ address: current.resolver, abi: resolverAbi, functionName: 'hasRoles', args: [value, 1n << 4n, editor], blockNumber: BigInt(current.blockNumber) })));
  return { allowed: rights.some(Boolean), broaderAccess: rights.slice(0, 3).some(Boolean), recordAccess: rights[3] };
}

/** Compare two concrete text permissions at one observed block. No wallet or write. */
export async function inspectPaymentEditorScope(client: PublicClient, input: string, editor: Address) {
  const current = await inspectPaymentName(client, input);
  await assertPermissionedResolver(client, current.resolver);
  const [payment, website] = await Promise.all([
    textEditorAccess(client, current, getAddress(editor), PAYMENT_RECORD),
    textEditorAccess(client, current, getAddress(editor), 'url'),
  ]);
  return { name: current.name, resolver: current.resolver, editor: getAddress(editor), blockNumber: current.blockNumber,
    paymentRecord: payment.allowed, websiteRecord: website.allowed, broaderPaymentAccess: payment.broaderAccess };
}
