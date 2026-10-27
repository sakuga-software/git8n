import { describe, expect, it } from 'vitest';
import { byLastChange } from '@/services/i18n-reachable.service';

const repository = (name: string, pushedAt: string | null) => ({ owner: 'acme', name, private: false, pushedAt });

describe('the order of the reachable repositories (DB-653)', () => {
  it('puts the repository changed last first, the undated ones last, and equal dates by name', () => {
    const rows = [
      repository('old', '2025-01-01T00:00:00Z'),
      repository('no-date-b', null),
      repository('new', '2026-10-27T16:00:00Z'),
      repository('same-b', '2026-05-01T00:00:00Z'),
      repository('no-date-a', null),
      repository('same-a', '2026-05-01T00:00:00Z'),
    ];

    expect(rows.sort(byLastChange).map((row) => row.name)).toEqual([
      'new',
      'same-a',
      'same-b',
      'old',
      'no-date-a',
      'no-date-b',
    ]);
  });
});
