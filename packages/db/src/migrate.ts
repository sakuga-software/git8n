import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_FOLDER } from './migrations';

/**
 * Applies the migrations that `DATABASE_URL` does not have yet, then stops.
 *
 * It keeps the journal of drizzle-kit: the table `drizzle.__drizzle_migrations`,
 * and the `when` of each entry of `meta/_journal.json`. So a database that
 * drizzle-kit migrated gets only the migrations that came after.
 *
 * WARNING: `MIGRATIONS_FOLDER` is relative to this file. The image puts the bundle
 * in `dist/` beside `drizzle/`, as `src/` is in the repository.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('The database is up to date.');
} catch (error) {
  // drizzle wraps the error of the driver, which says why: a refused connection, a wrong password.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';

  console.error(`The migrations failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
