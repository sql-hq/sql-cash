/** Historical public demo links must open the real wallet app, never sample money. */
export function canonicalPublicHash(hash: string): string {
  return /^#\/(?:console|demo)(?:[/?]|$)/i.test(hash) ? '#/app' : hash;
}
