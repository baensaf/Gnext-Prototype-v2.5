import { createHash, randomBytes, randomInt } from 'crypto';

/** No 0/O, 1/I/L: the code is read aloud and typed by hand at the branch. */
export const ENROLMENT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ENROLMENT_CODE_LENGTH = 8;
export const ENROLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEVICE_KEY_PREFIX = 'gak_';

export function generateEnrolmentCode(): string {
  let code = '';
  for (let i = 0; i < ENROLMENT_CODE_LENGTH; i++) {
    code += ENROLMENT_CODE_ALPHABET[randomInt(ENROLMENT_CODE_ALPHABET.length)];
  }
  return code;
}

/** What the agent sends and what we hash: upper case, no hyphens or spaces. */
export function normaliseEnrolmentCode(raw: string): string {
  return String(raw || '').replace(/[\s-]/g, '').toUpperCase();
}

/** How head office reads it out: `K7QM-4XPD`. */
export function formatEnrolmentCode(code: string): string {
  const c = normaliseEnrolmentCode(code);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** `gak_` + 32 random bytes in base64url (43 characters). */
export function generateDeviceKey(): string {
  return DEVICE_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * Both secrets are long random values, so a plain SHA-256 is enough to make a stolen table
 * useless without slowing down every agent request with a password hash.
 */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
