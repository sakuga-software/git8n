import { PGlite } from '@electric-sql/pglite';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { schema } from '@i18n-editor/db';
import { MIGRATIONS_FOLDER } from '@i18n-editor/db/migrations';
import { type Connection, type Database, useDatabase } from '@/db';

/** A PostgreSQL database in memory, with the migrations applied. */
export async function createTestDb(): Promise<Connection> {
  const client = new PGlite();
  const connection: Connection = { db: drizzle(client, { schema }), close: () => client.close() };

  await migrate(connection.db as PgliteDatabase<typeof schema>, { migrationsFolder: MIGRATIONS_FOLDER });

  return connection;
}

const TABLE_NAMES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table as PgTable)}"`)
  .join(', ');

/**
 * Gives the API a PGlite database for the tests of one file: `db()` of
 * `@/db` answers with it, and every table is empty at the start of each test.
 */
export function useTestDb(): { db: () => Database } {
  let connection: Connection | undefined;

  beforeAll(async () => {
    connection = await createTestDb();
    useDatabase(connection);
  });

  beforeEach(async () => {
    useDatabase(connection);
    await (connection as Connection).db.execute(sql.raw(`truncate table ${TABLE_NAMES} cascade`));
  });

  afterAll(async () => {
    useDatabase(undefined);
    await connection?.close();
  });

  return { db: () => (connection as Connection).db };
}
