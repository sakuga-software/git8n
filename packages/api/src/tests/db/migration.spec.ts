import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@git8n/db/migrations';

/** The migrations up to `tag`, in a folder of their own. */
function migrationsUpTo(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'migrations-'));

  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ tag: string }> };
  const last = journal.entries.findIndex((entry) => entry.tag === tag);

  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }));

  return folder;
}

/** Each row of `i18n_translators` became a member of every repository (DB-637). */
describe('migration 0005, members per repository', () => {
  const client = new PGlite();
  const db = drizzle(client);
  const before = migrationsUpTo('0004_message_templates');

  afterAll(async () => {
    await client.close();
    rmSync(before, { recursive: true, force: true });
  });

  it('copies each global grant to each repository, with the target languages of that repository only', async () => {
    await migrate(db, { migrationsFolder: before });
    await db.execute(
      sql`insert into users (id, name, email) values ('u1', 'Ann', 'a@example.test'), ('u2', 'Bob', 'b@example.test')`,
    );
    await db.execute(sql`
      insert into i18n_repositories (id, installation_id, owner, name, locales_path, languages)
      values ('r1', 1, 'acme', 'app', 'src', '{fr,en,de}'), ('r2', 1, 'acme', 'site', 'src', '{fr,en}')
    `);
    await db.execute(sql`
      insert into i18n_translators (user_id, languages, role, writes_source)
      values ('u1', '{en,de}', 'reviewer', true), ('u2', '{}', 'translator', false)
    `);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { rows: repositories } = await db.execute<{ id: string; organization_id: string; slug: string }>(sql`
      select r.id, r.organization_id, o.slug from i18n_repositories r join organizations o on o.id = r.organization_id order by r.id
    `);
    const { rows: grants } = await db.execute<{
      user_id: string;
      repository: string;
      role: string;
      writes_source: boolean;
      languages: string;
    }>(sql`
      select m.user_id, r.id as repository, m.role, m.writes_source,
        coalesce(string_agg(l.language, ',' order by l.language), '') as languages
      from members m
      join i18n_repositories r on r.organization_id = m.organization_id
      left join member_languages l on l.member_id = m.id
      group by m.id, m.user_id, r.id, m.role, m.writes_source
      order by m.user_id, r.id
    `);
    const { rows: tables } = await db.execute<{ name: string | null }>(
      sql`select to_regclass('i18n_translators') as name`,
    );

    expect(repositories).toEqual([
      { id: 'r1', organization_id: 'r1', slug: 'r1' },
      { id: 'r2', organization_id: 'r2', slug: 'r2' },
    ]);
    expect(grants).toEqual([
      { user_id: 'u1', repository: 'r1', role: 'reviewer', writes_source: true, languages: 'de,en' },
      { user_id: 'u1', repository: 'r2', role: 'reviewer', writes_source: true, languages: 'en' },
      { user_id: 'u2', repository: 'r1', role: 'translator', writes_source: false, languages: '' },
      { user_id: 'u2', repository: 'r2', role: 'translator', writes_source: false, languages: '' },
    ]);
    expect(tables).toEqual([{ name: null }]);
  });
});
