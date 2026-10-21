import { RAILGUN_FEE_BPS, USDC } from './network';

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,6}))?$/;

/** Parses a decimal USDC string ("12.5") into base units. Rejects signs, exponents and >6 decimals. */
export function parseUsdc(value: string): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Invalid USDC amount "${value}". Use a decimal with up to ${USDC.decimals} places.`);
  const units = BigInt(match[1]) * 10n ** BigInt(USDC.decimals) + BigInt((match[2] ?? '').padEnd(USDC.decimals, '0') || '0');
  if (units <= 0n) throw new RangeError('Amount must be greater than zero.');
  return units;
}

export function formatUsdc(units: bigint): string {
  const negative = units < 0n; const abs = negative ? -units : units;
  const base = 10n ** BigInt(USDC.decimals);
  const frac = (abs % base).toString().padStart(USDC.decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / base}${frac ? `.${frac}` : ''}`;
}

/** Railgun takes its fee from the shielded or unshielded amount. */
export function railgunFee(units: bigint): bigint { return units * RAILGUN_FEE_BPS / 10_000n; }

export function afterFee(units: bigint): bigint { return units - railgunFee(units); }
