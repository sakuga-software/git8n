/**
 * The SQLSTATE code of a PostgreSQL error, or `undefined` for another error.
 * Drizzle wraps the error of the driver in `cause`, so the code can sit one
 * level down.
 */
export function pgCodeOf(error: unknown): string | undefined {
  let current = error;

  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
