import { fileURLToPath } from 'node:url';

/**
 * The folder of the SQL migrations that `db:generate` writes.
 *
 * The path is relative to this file. If a bundler puts this module into a bundle, the path points
 * to the wrong folder. For this reason, the entry point `.` does not export it.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/migrations', import.meta.url));
