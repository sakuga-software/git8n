import { describe, expect, it, vi } from 'vitest';
import { createCache, forgetRepository } from '@/utils/cache';

const later = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });

  return { promise, resolve, reject };
};

describe('createCache', () => {
  it('holds an answer for its time, then reads again', async () => {
    const cache = createCache<number>(1000);
    const read = vi.fn(async () => read.mock.calls.length);

    expect(await cache.get('r1:en', read, 0)).toBe(1);
    expect(await cache.get('r1:en', read, 999)).toBe(1);
    expect(await cache.get('r1:en', read, 1000)).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('gives two callers of a cold key the same read', async () => {
    const cache = createCache<string>(1000);
    const pending = later<string>();
    const read = vi.fn(() => pending.promise);
    const first = cache.get('r1', read, 0);
    const second = cache.get('r1', read, 0);

    pending.resolve('answer');

    expect(await Promise.all([first, second])).toEqual(['answer', 'answer']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('holds no failure: the next caller reads again', async () => {
    const cache = createCache<string>(1000);
    const read = vi.fn().mockRejectedValueOnce(new Error('GitHub is down')).mockResolvedValueOnce('answer');

    await expect(cache.get('r1', read, 0)).rejects.toThrow('GitHub is down');
    expect(await cache.get('r1', read, 1)).toBe('answer');
  });

  it('gives a rejection for a read that throws before its first await', async () => {
    const cache = createCache<string>(1000);

    await expect(
      cache.get('r1', () => {
        throw new Error('unknown language');
      }),
    ).rejects.toThrow('unknown language');
  });

  it('does not hold the answer of a read that a write forgot in flight', async () => {
    const cache = createCache<string>(1000);
    const pending = later<string>();
    const inFlight = cache.get('r1:en', () => pending.promise, 0);

    cache.forget('r1');
    pending.resolve('before the write');

    expect(await inFlight).toBe('before the write');
    expect(await cache.get('r1:en', async () => 'after the write', 1)).toBe('after the write');
  });

  it('holds the read that started after a write, even if a read of before it ends last', async () => {
    const cache = createCache<string>(1000);
    const before = later<string>();
    const after = later<string>();
    const first = cache.get('r1', () => before.promise, 0);

    cache.forget('r1');

    const second = cache.get('r1', () => after.promise, 0);

    after.resolve('after the write');
    await second;
    before.resolve('before the write');
    await first;

    expect(cache.peek('r1', 1)?.value).toBe('after the write');
    expect(await cache.get('r1', async () => 'a third read', 1)).toBe('after the write');
  });

  it('does not hold a read of before a write that ends when no read is in flight', async () => {
    const cache = createCache<string>(1000);
    const before = later<string>();
    const first = cache.get('r1', () => before.promise, 0);

    cache.forget('r1');
    await cache.get('r1', async () => 'after the write', 0);
    cache.forget('r1');
    before.resolve('before the write');
    await first;

    expect(cache.peek('r1', 1)).toBeUndefined();
    expect(await cache.get('r1', async () => 'a new read', 1)).toBe('a new read');
  });

  it('forgets a key and the keys under it, and no other repository', async () => {
    const cache = createCache<string>(1000);

    await cache.get('r1', async () => 'r1', 0);
    await cache.get('r1:en', async () => 'r1:en', 0);
    await cache.get('r10:en', async () => 'r10:en', 0);

    cache.forget('r1');

    expect(cache.peek('r1', 1)).toBeUndefined();
    expect(cache.peek('r1:en', 1)).toBeUndefined();
    expect(cache.peek('r10:en', 1)).toEqual({ value: 'r10:en', fresh: true });
  });

  it('can hold each answer for a time of its own', async () => {
    const cache = createCache<{ failed: boolean }>((answer) => (answer.failed ? 10 : 1000));

    await cache.get('a', async () => ({ failed: true }), 0);
    await cache.get('b', async () => ({ failed: false }), 0);

    expect(cache.peek('a', 10)?.fresh).toBe(false);
    expect(cache.peek('b', 10)?.fresh).toBe(true);
  });
});

describe('forgetRepository', () => {
  it('drops the answers of one repository in every cache', async () => {
    const catalogues = createCache<string>(1000);
    const progress = createCache<string>(1000);

    await catalogues.get('r1:en', async () => 'catalogue', 0);
    await progress.get('r1', async () => 'progress', 0);
    await progress.get('r2', async () => 'other', 0);

    forgetRepository('r1');

    expect(catalogues.peek('r1:en', 1)).toBeUndefined();
    expect(progress.peek('r1', 1)).toBeUndefined();
    expect(progress.peek('r2', 1)?.value).toBe('other');
  });
});
