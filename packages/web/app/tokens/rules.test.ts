import { describe, expect, it } from 'vitest';
import { daysOf, detailOf } from './rules';

const token = {
  id: 't',
  name: 'CI',
  start: 'g8n_abcd',
  createdAt: '2026-10-28T10:00:00.000Z',
  expiresAt: '2026-11-27T10:00:00.000Z' as string | null,
  lastUsedAt: null as string | null,
};

describe('the access tokens of the page', () => {
  it('reads a life of the form as days, and « none » as no end', () => {
    expect(daysOf('30')).toBe(30);
    expect(daysOf('none')).toBeNull();
  });

  it('says when a token was made, when it ends, and when it last served', () => {
    expect(detailOf(token, new Date('2026-10-29'))).toBe(
      'Créé le 28 oct. 2026 · expire le 27 nov. 2026 · jamais utilisé',
    );
    expect(detailOf({ ...token, expiresAt: null, lastUsedAt: '2026-10-29T08:00:00.000Z' })).toBe(
      'Créé le 28 oct. 2026 · sans expiration · utilisé le 29 oct. 2026',
    );
  });

  it('says that a token expired', () => {
    expect(detailOf(token, new Date('2026-12-01'))).toBe(
      'Créé le 28 oct. 2026 · expiré le 27 nov. 2026 · jamais utilisé',
    );
  });
});
