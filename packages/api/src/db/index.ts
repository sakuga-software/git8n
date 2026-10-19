import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type Database, schema } from '@i18n-editor/db';

export type { Database };

export interface Connection {
  db: Database;
  close: () => Promise<void>;
}

let current: Connection | undefined;

/**
 * The database of the API. The server opens it with `connectDatabase` before
 * it takes a request, and a test puts its own with `useDatabase`.
 */
export function db(): Database {
  if (!current) throw new Error('No database: call connectDatabase before the first query');

  return current.db;
}

export function connectDatabase(url: string, options: { tls?: boolean } = {}): Connection {
  const client = postgres(url, { max: 5, ...(options.tls ? { ssl: 'require' as const } : {}) });

  current = { db: drizzle(client, { schema }), close: () => client.end() };

  return current;
}

/** Puts `connection` in place of the database of the API. The tests call it. */
export function useDatabase(connection: Connection | undefined): void {
  current = connection;
}
