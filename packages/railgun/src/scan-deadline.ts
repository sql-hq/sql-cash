// Stop waiting in the UI, not the underlying SDK operation. Callers must keep
// their serialization queue attached to the original task until it settles.
export async function withinScanDeadline<T>(task: Promise<T>, timeoutMs = 15 * 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('History synchronization is taking longer than expected. Transfers remain blocked. The background scan may still be running; retry after it has progressed.')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
