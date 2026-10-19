import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** A database of this schema, on a PostgreSQL server or on PGlite in the tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
