import { describe, expect, it } from 'vitest';
import { withoutTrailingSlashes } from '@/utils/trailing-slashes';

describe('withoutTrailingSlashes', () => {
  it('removes every slash at the end', () => {
    expect(withoutTrailingSlashes('locales///')).toBe('locales');
    expect(withoutTrailingSlashes('apps/web/locales/')).toBe('apps/web/locales');
  });

  it('keeps the slashes inside and a path that has none at the end', () => {
    expect(withoutTrailingSlashes('a//b')).toBe('a//b');
    expect(withoutTrailingSlashes('locales')).toBe('locales');
  });

  it('answers an empty string for a path of slashes only', () => {
    expect(withoutTrailingSlashes('///')).toBe('');
    expect(withoutTrailingSlashes('')).toBe('');
  });

  it('reads a long run of slashes in linear time', () => {
    const start = performance.now();
    withoutTrailingSlashes(`${'/'.repeat(200_000)}x`);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
