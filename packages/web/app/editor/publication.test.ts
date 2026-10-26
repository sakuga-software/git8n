import { describe, expect, it } from 'vitest';
import { publishedWhere, pullLabelOf } from './publication';

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

describe('publishedWhere', () => {
  it('names the pull request, or the branch when there is none', () => {
    expect(publishedWhere('main', { ...pull, state: 'open' })).toBe('dans la PR #7');
    expect(publishedWhere('main', null)).toBe('sur main');
    expect(publishedWhere('main', undefined)).toBe('sur main');
  });
});
