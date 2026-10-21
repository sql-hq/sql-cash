const ITERATIONS = 600_000;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > 24_000) throw new Error('Invalid encrypted backup.');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
};
export type VaultBackup = { format: 'sql-railgun-backup'; version: 1; network: 1; address: string; createdAt: string; iterations: number; salt: string; iv: string; ciphertext: string };
async function backupKey(password: string, salt: Uint8Array, iterations: number) {
  if (password.length < 10) throw new Error('Use a backup password of at least 10 characters.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptVaultBackup(mnemonic: string, password: string, address: string): Promise<VaultBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(password, salt, ITERATIONS);
  const aad = new TextEncoder().encode(`sql-railgun-backup:1:1:${address}`);
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(mnemonic.trim()));
  return { format: 'sql-railgun-backup', version: 1, network: 1, address, createdAt: new Date().toISOString(), iterations: ITERATIONS, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(bytes)) };
}
export function parseVaultBackup(text: string): VaultBackup {
  if (text.length > 32_768) throw new Error('The backup file is too large.');
  let value: VaultBackup;
  try { value = JSON.parse(text); } catch { throw new Error('Choose a valid encrypted vault backup.'); }
  if (!value || value.format !== 'sql-railgun-backup' || value.version !== 1 || value.network !== 1 ||
    !/^0zk1[0-9a-z]{50,250}$/i.test(value.address) || !Number.isSafeInteger(value.iterations) || value.iterations < 200_000 || value.iterations > 1_000_000 ||
    decode(value.salt).length !== 16 || decode(value.iv).length !== 12 || decode(value.ciphertext).length < 17) throw new Error('This encrypted vault backup is invalid or unsupported.');
  return value;
}
export async function decryptVaultBackup(file: VaultBackup, password: string) {
  const verified = parseVaultBackup(JSON.stringify(file));
  try {
    const key = await backupKey(password, decode(verified.salt), verified.iterations);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(verified.iv) as BufferSource, additionalData: new TextEncoder().encode(`sql-railgun-backup:1:1:${verified.address}`) }, key, decode(verified.ciphertext) as BufferSource);
    return new TextDecoder().decode(bytes);
  } catch { throw new Error('The backup password is incorrect or the file has been changed.'); }
}
export function downloadVaultBackup(file: VaultBackup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sql-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
