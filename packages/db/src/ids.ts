import { randomBytes } from 'node:crypto';

const PROCESS_BYTES = randomBytes(5).toString('hex');
let counter = randomBytes(3).readUIntBE(0, 3);

/**
 * A new identifier in the form of MongoDB: the second of `now`, five random
 * bytes of the process, then a counter. The rows keep the identifiers of the
 * documents they come from (`schema.ts`), and the admin reads the date of
 * creation of an account from its identifier, so a new row gets the same form.
 */
export function newId(now = new Date()): string {
  counter = (counter + 1) % 0x1000000;

  const seconds = Math.floor(now.getTime() / 1000)
    .toString(16)
    .padStart(8, '0');

  return `${seconds}${PROCESS_BYTES}${counter.toString(16).padStart(6, '0')}`;
}

/** The identifier of a row: 24 hexadecimal characters. */
export const isId = (value: string): boolean => /^[a-f\d]{24}$/i.test(value);

/**
 * The date that the first four bytes of an identifier carry.
 *
 * The guard on `isId` comes first. `Number.parseInt` reads a hexadecimal prefix
 * and drops the characters that follow, so a value such as `deadbeef-invalid`
 * gives a date without it.
 */
export function dateOfId(id: string): Date | undefined {
  if (!isId(id)) return undefined;

  const seconds = Number.parseInt(id.slice(0, 8), 16);

  return Number.isNaN(seconds) ? undefined : new Date(seconds * 1000);
}
