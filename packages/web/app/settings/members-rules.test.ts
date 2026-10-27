import { describe, expect, it } from 'vitest';
import { personOf, rightsChange, sameRights } from './members-rules';

describe('personOf', () => {
  it('reads an address, in lower case', () => {
    expect(personOf('  Ana@Example.fr ')).toEqual({ email: 'ana@example.fr' });
  });

  it('reads a GitHub login, with or without its @', () => {
    expect(personOf('octo-cat')).toEqual({ githubLogin: 'octo-cat' });
    expect(personOf('@octocat')).toEqual({ githubLogin: 'octocat' });
  });

  it('names nobody for a text that is neither', () => {
    for (const typed of ['', 'two words', 'ana@', '-dash', 'double--dash', 'a'.repeat(40)]) {
      expect(personOf(typed)).toBeNull();
    }
  });
});

describe('sameRights', () => {
  it('reads the languages as a set', () => {
    const rights = { role: 'reviewer' as const, writesSource: false };

    expect(sameRights({ ...rights, languages: ['en', 'de'] }, { ...rights, languages: ['de', 'en'] })).toBe(true);
    expect(sameRights({ ...rights, languages: ['en'] }, { ...rights, languages: ['de'] })).toBe(false);
    expect(sameRights({ ...rights, languages: [] }, { ...rights, role: 'owner', languages: [] })).toBe(false);
  });
});

describe('rightsChange', () => {
  it('names the fields that changed, and no other', () => {
    const saved = { role: 'translator' as const, languages: ['en'], writesSource: false };

    expect(rightsChange(saved, { ...saved, languages: ['de', 'en'] })).toEqual({ languages: ['de', 'en'] });
    expect(rightsChange(saved, { ...saved, role: 'reviewer' })).toEqual({ role: 'reviewer' });
    expect(rightsChange(saved, { ...saved, languages: ['en'] })).toEqual({});
  });
});
