import { describe, expect, it } from 'vitest';
import { publishedWhere, pullLabelOf, pullNextOf } from './publication';

const pull = { number: 7, url: 'https://github.com/acme/app/pull/7', mergeable: true } as const;

describe('pullLabelOf', () => {
  it('names each state of the pull request', () => {
    expect(pullLabelOf({ ...pull, state: 'open' })).toEqual({ text: 'PR #7 ouverte', tone: 'proposed' });
    expect(pullLabelOf({ ...pull, state: 'merged', mergeable: null })).toEqual({
      text: 'PR #7 fusionnée',
      tone: 'published',
    });
    expect(pullLabelOf({ ...pull, state: 'closed', mergeable: null })).toEqual({ text: 'PR #7 fermée', tone: 'muted' });
    expect(pullLabelOf(null)).toEqual({ text: 'Aucune pull request', tone: 'muted' });
  });

  it('names a conflict before the open state', () => {
    expect(pullLabelOf({ ...pull, state: 'open', mergeable: false })).toEqual({
      text: 'PR #7 en conflit',
      tone: 'alarm',
    });
  });

  it('keeps an open pull request open while GitHub computes whether it merges', () => {
    expect(pullLabelOf({ ...pull, state: 'open', mergeable: null }).text).toBe('PR #7 ouverte');
  });
});

describe('pullNextOf', () => {
  it('says where the next publication goes', () => {
    expect(pullNextOf({ ...pull, state: 'open' }, 'main')).toBe("Les publications s'ajoutent à cette pull request.");
    expect(pullNextOf(null, 'main')).toBe('La première publication ouvrira une pull request.');
    expect(pullNextOf({ ...pull, state: 'merged', mergeable: null }, 'main')).toBe(
      'La prochaine publication ouvrira une nouvelle pull request.',
    );
    expect(pullNextOf({ ...pull, state: 'closed', mergeable: null }, 'main')).toBe(
      'La prochaine publication ouvrira une nouvelle pull request.',
    );
  });

  it('names the base branch of a pull request in conflict', () => {
    expect(pullNextOf({ ...pull, state: 'open', mergeable: false }, 'main')).toContain('en conflit avec main');
  });
});

describe('publishedWhere', () => {
  it('names the pull request, or the branch when there is none', () => {
    expect(publishedWhere('main', { ...pull, state: 'open' })).toBe('dans la PR #7');
    expect(publishedWhere('main', null)).toBe('sur main');
    expect(publishedWhere('main', undefined)).toBe('sur main');
  });
});
