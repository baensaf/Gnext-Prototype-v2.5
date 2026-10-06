// ----------------------------------------------------------------------

/**
 * A random UUID (version 4).
 *
 * `crypto.randomUUID` exists only in a secure context (https or localhost), and the branch agent's
 * LAN listener is plain http on the PC's address (agent-protocol §19.4), so it can be missing: then
 * the id is made from `crypto.getRandomValues`, which has no such limit, or, with no `crypto` at
 * all, from `Math.random`.
 */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] % 16) + 0x40; // version 4
  bytes[8] = (bytes[8] % 64) + 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
