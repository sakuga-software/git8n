/** What the API answers of a code that the page reads (DB-669). */
export interface DeviceAnswer {
  status: 'pending' | 'approved' | 'denied';
  /** Present only when the code waits for the account of this page. */
  client_id?: string;
}

export type DeviceState =
  | { kind: 'ask' }
  | { kind: 'review' }
  | { kind: 'elsewhere' }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'unknown' };

/** The code of the terminal, as a person types it: « abcd-1234 » or « ABCD 1234 ». */
export const normalCode = (typed: string): string => typed.replace(/[^a-z0-9]/gi, '').toUpperCase();

/** « ABCD-1234 », as the terminal shows it. */
export const shownCode = (code: string): string => {
  const normal = normalCode(code);

  return normal.length === 8 ? `${normal.slice(0, 4)}-${normal.slice(4)}` : normal;
};

/**
 * What the page shows for an answer of the API.
 *
 * A code that waits with no `client_id` belongs to another account: the
 * first account that opens a code holds it.
 */
export const stateOf = (answer: DeviceAnswer | null): DeviceState => {
  if (answer === null) return { kind: 'unknown' };
  if (answer.status === 'approved') return { kind: 'approved' };
  if (answer.status === 'denied') return { kind: 'denied' };

  return answer.client_id === undefined ? { kind: 'elsewhere' } : { kind: 'review' };
};
