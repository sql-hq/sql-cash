/** Log error types/codes and source locations without transaction bodies or secrets. */
export function operationDiagnostic(reason: unknown) {
  const causes: { name: string; code?: string | number; location?: string; detail?: string }[] = [];
  const seen = new Set<unknown>();
  for (let item: unknown = reason; item && typeof item === 'object' && causes.length < 5 && !seen.has(item); item = (item as { cause?: unknown }).cause) {
    seen.add(item);
    const error = item as { name?: unknown; code?: unknown; stack?: unknown; message?: unknown };
    const name = typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'UnknownError';
    const code = typeof error.code === 'number' && Number.isSafeInteger(error.code) ? error.code : typeof error.code === 'string' && /^[A-Za-z_]{1,64}$/.test(error.code) ? error.code : undefined;
    const location = typeof error.stack === 'string' ? error.stack.split('\n').slice(1).map(line => line.match(/\/assets\/([A-Za-z0-9_.-]+\.js:\d+:\d+)/)?.[1]).find(Boolean) : undefined;
    const detail = typeof error.message === 'string' && /^(Do not know how to serialize a BigInt|Cannot read properties of (undefined|null) \(reading '[A-Za-z_]{1,40}'\))$/.test(error.message) ? error.message : undefined;
    causes.push({ name, ...(code !== undefined ? { code } : {}), ...(location ? { location } : {}), ...(detail ? { detail } : {}) });
  }
  return causes;
}
