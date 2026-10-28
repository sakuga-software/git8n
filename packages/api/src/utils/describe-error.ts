import { pgCodeOf } from '@git8n/db';

/** Separates the message of the wrapper from the diagnostic that follows it. */
const JOIN = ' — ';

/** Marks a description that was cut, so a reader knows they have a part. */
const CUT = '…';

/**
 * What to put in a log for an error, with the PostgreSQL failure it hides.
 *
 * Drizzle puts its own sentence in `message` — « Failed query: select … » —
 * and the error of the driver in `cause`. A log that reads `message` alone
 * therefore says that a query failed and never says **why**: a table that is
 * not there, a statement that timed out and a refused permission all print the
 * same line.
 *
 * That cost a production incident on 2026-09-23. `/admin/stats/kpis` answered
 * 500 every few seconds with « Failed query: select … from
 * "account_completion" », and nothing in the log told a missing table from a
 * lock.
 *
 * So this adds what discriminates them: the SQLSTATE code, and the sentence of
 * the cause when it says more than the wrapper. `42P01` is a relation that does
 * not exist, `42703` a column, `57014` a statement that was cancelled, `42501`
 * a permission.
 *
 * `maxLength` is for a caller that writes the result to a column. **The cut
 * takes from the message and keeps the diagnostic.** Drizzle puts the whole
 * statement in `message`, so a long query fills the budget on its own, and a
 * cut that starts at the end takes away the two parts that say which failure
 * it was.
 */
export function describeError(error: unknown, maxLength?: number): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = pgCodeOf(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;

  const codePart = code ? [`SQLSTATE ${code}`] : [];
  const withoutCause = assemble(message, codePart, maxLength);

  // The cause is left out only when the text that survives says it already.
  // A wrapper can repeat its cause past the cut, where it says nothing, so the
  // test reads the result and never the whole message. Putting the cause back
  // makes the message shorter, never longer, so this choice cannot swing back.
  if (!causeMessage || withoutCause.includes(causeMessage)) return withoutCause;

  return assemble(message, [causeMessage, ...codePart], maxLength);
}

/** `message`, cut to `maxLength` if it is given, with `diagnostic` after it. */
function assemble(message: string, diagnostic: string[], maxLength?: number): string {
  const suffix = diagnostic.length > 0 ? JOIN + diagnostic.join(JOIN) : '';

  if (maxLength === undefined || message.length + suffix.length <= maxLength) {
    return message + suffix;
  }

  const room = maxLength - suffix.length - CUT.length;

  // The diagnostic alone fills the budget. Its end carries the SQLSTATE code,
  // so the cut starts at the front.
  if (room <= 0) return CUT + suffix.slice(suffix.length - maxLength + CUT.length);

  return message.slice(0, room) + CUT + suffix;
}
