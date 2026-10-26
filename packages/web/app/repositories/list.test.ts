import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, pagesOf, paramsOf, percentOf, searchedFor, sortedBy, stateOf } from './list';

describe('the state of the list in the address', () => {
  it('reads the default from an empty address, and writes nothing for it', () => {
    expect(stateOf(new URLSearchParams())).toEqual(DEFAULT_STATE);
    expect(paramsOf(DEFAULT_STATE).toString()).toBe('');
  });

  it('reads back what it writes', () => {
    const state = { q: 'acme', sort: 'progress' as const, order: 'desc' as const, page: 3 };

    expect(stateOf(paramsOf(state))).toEqual(state);
  });

  it('reads a value it does not know as the default', () => {
    expect(stateOf(new URLSearchParams('sort=size&order=up&page=-2'))).toEqual(DEFAULT_STATE);
    expect(stateOf(new URLSearchParams('page=1.5')).page).toBe(1);
  });
});

describe('a click on a column', () => {
  it('turns the order of the same column over, and goes back to the first page', () => {
    expect(sortedBy({ ...DEFAULT_STATE, page: 4 }, 'name')).toEqual({ ...DEFAULT_STATE, order: 'desc' });
  });

  it('starts a date and a progress from the most recent and the furthest', () => {
    expect(sortedBy(DEFAULT_STATE, 'created').order).toBe('desc');
    expect(sortedBy(DEFAULT_STATE, 'progress').order).toBe('desc');
    expect(sortedBy({ ...DEFAULT_STATE, sort: 'created' }, 'name').order).toBe('asc');
  });
});

it('starts a new search at the first page, without the spaces around it', () => {
  expect(searchedFor({ ...DEFAULT_STATE, page: 3 }, '  acme ')).toEqual({ ...DEFAULT_STATE, q: 'acme' });
});

it('counts one page for an empty list', () => {
  expect(pagesOf(0, 20)).toBe(1);
  expect(pagesOf(41, 20)).toBe(3);
});

it('says 100 % only when every key is published', () => {
  expect(percentOf({ language: 'en', published: 999, proposed: 0, missing: 1, review: 0, total: 1000 })).toBe(99);
  expect(percentOf({ language: 'en', published: 0, proposed: 0, missing: 0, review: 0, total: 0 })).toBe(100);
});
