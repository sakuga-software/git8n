import '../setup-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../app';
import { clearReachableCache } from '@/services/i18n-reachable.service';
import { signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();
  const repository = (owner: string, name: string, pushedAt: string | null) => ({
    owner,
    name,
    private: false,
    pushedAt,
  });

  return {
    ...real,
    installations: async () => [
      { id: 1, account: 'acme' },
      { id: 2, account: 'beta' },
    ],
    repositoriesOf: async (installationId: number) =>
      installationId === 1
        ? [repository('acme', 'alpha', '2025-03-01T00:00:00Z'), repository('acme', 'zeta', '2026-10-27T09:00:00Z')]
        : [repository('beta', 'archive', null), repository('beta', 'app', '2026-10-27T16:00:00Z')],
  };
});

useTestDb();

beforeEach(() => clearReachableCache());

describe('GET /i18n/installations/repositories (DB-653)', () => {
  it('lists the repository changed last first, over every installation and every page', async () => {
    const { headers } = await signedInAdmin();
    const names: string[] = [];

    for (const page of [1, 2]) {
      const res = await app.request(`/i18n/installations/repositories?page=${page}&perPage=2`, { headers });
      const { rows } = ((await res.json()) as { data: { rows: Array<{ owner: string; name: string }> } }).data;

      names.push(...rows.map((row) => `${row.owner}/${row.name}`));
    }

    expect(names).toEqual(['beta/app', 'acme/zeta', 'acme/alpha', 'beta/archive']);
  });
});
