import { formatAmount, parseAmount } from '@null-protocol/sdk';

export function money(value: bigint, exact = false): string {
  if (value < 0n) return `−${money(-value, exact)}`;
  const [whole, fraction = ''] = formatAmount(value).split('.');
  return `${BigInt(whole).toLocaleString('en-US')}.${exact ? fraction.padEnd(6, '0') : fraction.padEnd(2, '0').slice(0, 2)}`;
}
export function amount(value: string): bigint { try { return parseAmount(value); } catch { return 0n; } }
export function short(value: string, size = 7): string { return value.length > size * 2 + 3 ? `${value.slice(0, size)}…${value.slice(-size)}` : value; }
export function date(value: string): string { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
export function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  link.hidden = true; document.body.appendChild(link); link.click(); link.remove();
  // Give browsers time to hand the Blob to their download manager.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function stringify(value: unknown): string { return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2); }

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Close the quoted field in your CSV and try again.');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
