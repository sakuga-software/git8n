import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '@i18n-editor/mcp/api';
import { forgetReads, mayPoll, quietly, readErrorOf, readOf, reads, readsFor, type Read } from './use-read';

/** A read that answers when the test says so. */
const held = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { read: () => promise, resolve, reject };
};

/** Lets the callbacks of the promises that just settled run. */
const settled = () => new Promise((done) => setTimeout(done, 0));

/**
 * The reads of one screen, through the cache. `open` points the screen at a
 * key, as `useRead` does when its key changes, and `seen` holds what the
 * screen drew after each change.
 */
const screen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 0, retry: false, networkMode: 'always' } },
  });
  const seen: Array<Read<string>> = [];
  const observer = new QueryObserver<string>(client, { queryKey: ['none'], enabled: false });

  observer.subscribe((result) => seen.push(readOf(result)));

  return {
    seen,
    client,
    open: (key: string, read: () => Promise<string>) => observer.setOptions({ queryKey: [key], queryFn: read }),
    reload: () => void observer.refetch(),
    now: () => readOf(observer.getCurrentResult()),
  };
};

describe('the last read alone answers', () => {
  it('says loading, then the value', async () => {
    const { open, now } = screen();
    const english = held<string>();

    open('en', english.read);

    expect(now()).toEqual({ state: 'loading' });

    english.resolve('en');
    await settled();

    expect(now()).toEqual({ state: 'done', value: 'en' });
  });

  /**
   * English is slow, and the translator opens German before it answers. The
   * English table must not land under the German header.
   */
  it('drops the answer of a read that a later read replaced', async () => {
    const { open, now } = screen();
    const english = held<string>();
    const german = held<string>();

    open('en', english.read);
    open('de', german.read);
    german.resolve('de');
    await settled();
    english.resolve('en');
    await settled();

    expect(now()).toEqual({ state: 'done', value: 'de' });
  });

  it('drops the failure of a read that a later read replaced', async () => {
    const { open, now } = screen();
    const english = held<string>();
    const german = held<string>();

    open('en', english.read);
    open('de', german.read);
    english.reject(new Error('too late'));
    await settled();

    expect(now()).toEqual({ state: 'loading' });
  });

  it('reads again on a reload, after a failure', async () => {
    const { open, reload, seen } = screen();
    const reads = [held<string>(), held<string>()];
    let turn = 0;

    open('en', () => reads[turn++].read());
    reads[0].reject(new ApiError('{"message":"GitHub answered 502"}', 500));
    await settled();
    reload();
    reads[1].resolve('en');
    await settled();

    expect(seen.map((answer) => answer.state).filter((state, at, all) => state !== all[at - 1])).toEqual([
      'loading',
      'failed',
      'loading',
      'done',
    ]);
  });
});

/**
 * After a proposal the page reads again. The table used to leave for a
 * spinner, and the translator lost the place in the list (DB-241).
 */
describe('a read of the same thing keeps what is on the screen', () => {
  it('keeps the last answer while the new one is on its way', async () => {
    const { open, reload, now } = screen();
    const reads = [held<string>(), held<string>()];
    let turn = 0;

    open('en', () => reads[turn++].read());
    reads[0].resolve('before');
    await settled();
    reload();

    expect(now()).toEqual({ state: 'done', value: 'before', refreshing: true });

    reads[1].resolve('after');
    await settled();

    expect(now()).toEqual({ state: 'done', value: 'after' });
  });

  it('keeps the last answer when the new read fails, and says that it can be out of date', async () => {
    const { open, reload, now } = screen();
    const reads = [held<string>(), held<string>()];
    let turn = 0;

    open('en', () => reads[turn++].read());
    reads[0].resolve('before');
    await settled();
    reload();
    reads[1].reject(new ApiError('{"message":"GitHub answered 502"}', 500));
    await settled();

    expect(now()).toEqual({ state: 'done', value: 'before', stale: { status: 500, message: 'GitHub answered 502' } });
  });

  /** Another language is another thing. Its table must not start with the rows of the language before. */
  it('shows nothing of the thing before for a read of something else', async () => {
    const { open, now } = screen();
    const english = held<string>();
    const german = held<string>();

    open('en', english.read);
    english.resolve('en');
    await settled();
    open('de', german.read);

    expect(now()).toEqual({ state: 'loading' });

    german.reject(new Error('refused'));
    await settled();

    expect(now()).toMatchObject({ state: 'failed' });
  });

  /** Back to English after German: the cache shows English at once, and reads it again (DB-638). */
  it('shows the answer of the cache for a thing read before, and reads it again', async () => {
    const { open, now } = screen();
    const reads = [held<string>(), held<string>(), held<string>()];
    let turn = 0;
    const read = () => reads[turn++].read();

    open('en', read);
    reads[0].resolve('en');
    await settled();
    open('de', read);
    reads[1].resolve('de');
    await settled();
    open('en', read);

    expect(now()).toEqual({ state: 'done', value: 'en', refreshing: true });

    reads[2].resolve('en, again');
    await settled();

    expect(now()).toEqual({ state: 'done', value: 'en, again' });
  });

  /** Nothing was ever read: there is nothing to keep, and a dash stays a dash. */
  it('has nothing to keep after a first read that failed', async () => {
    const { open, reload, now } = screen();
    const reads = [held<string>(), held<string>()];
    let turn = 0;

    open('en', () => reads[turn++].read());
    reads[0].reject(new Error('refused'));
    await settled();
    reload();

    expect(now()).toEqual({ state: 'loading' });
  });
});

describe('a write forgets the reads it changed', () => {
  afterEach(() => reads.clear());

  const answered = async (key: string[], value: string) => {
    await reads.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve(value) });
  };

  it('drops a read that no page shows, and every read under the same start', async () => {
    await answered(['catalogue', 'repo', 'en'], 'en');
    await answered(['catalogue', 'repo', 'de'], 'de');
    await answered(['catalogue', 'other', 'en'], 'other');

    forgetReads('catalogue\nrepo');

    expect(reads.getQueryData(['catalogue', 'repo', 'en'])).toBeUndefined();
    expect(reads.getQueryData(['catalogue', 'repo', 'de'])).toBeUndefined();
    expect(reads.getQueryData(['catalogue', 'other', 'en'])).toBe('other');
  });

  /** The page that wrote draws its write on top of the read: the read must stay under it. */
  it('keeps a read that a page shows', async () => {
    await answered(['catalogue', 'repo', 'en'], 'en');
    const observer = new QueryObserver(reads, { queryKey: ['catalogue', 'repo', 'en'], enabled: false });
    const stop = observer.subscribe(() => undefined);

    forgetReads('catalogue\nrepo\nen');

    expect(reads.getQueryData(['catalogue', 'repo', 'en'])).toBe('en');
    stop();
  });
});

describe('the cache belongs to one account', () => {
  afterEach(() => {
    readsFor(null);
    reads.clear();
  });

  const answered = (value: string) => reads.fetchQuery({ queryKey: ['me'], queryFn: () => Promise.resolve(value) });

  it('keeps the answers while the account stays', async () => {
    readsFor('ana');
    await answered('rights of Ana');
    readsFor('ana');

    expect(reads.getQueryData(['me'])).toBe('rights of Ana');
  });

  /** Ana signs out and Ben signs in, in the same tab: Ben must not see the rights of Ana. */
  it('forgets every answer when the account changes, or signs out', async () => {
    readsFor('ana');
    await answered('rights of Ana');
    readsFor('ben');

    expect(reads.getQueryData(['me'])).toBeUndefined();

    await answered('rights of Ben');
    readsFor(null);

    expect(reads.getQueryData(['me'])).toBeUndefined();
  });
});

describe('what a failed read says', () => {
  it('carries the status and the message of the API, out of its JSON', () => {
    expect(readErrorOf(new ApiError('{"message":"This account neither administers nor translates."}', 403))).toEqual({
      status: 403,
      message: 'This account neither administers nor translates.',
    });
  });

  it('keeps a body that is not JSON as it is', () => {
    expect(readErrorOf(new ApiError('Bad Gateway', 502))).toEqual({ status: 502, message: 'Bad Gateway' });
  });

  it('carries no status for a call that never reached the API', () => {
    expect(readErrorOf(new TypeError('Failed to fetch'))).toEqual({ status: null, message: 'Failed to fetch' });
  });
});

describe('a poll (DB-651)', () => {
  it('starts only when the tab shows, no poll is in flight, and the page allows it', () => {
    expect(mayPoll(true, false)).toBe(true);
    expect(mayPoll(false, false)).toBe(false);
    expect(mayPoll(true, true)).toBe(false);
    expect(mayPoll(true, false, () => false)).toBe(false);
    expect(mayPoll(true, false, () => true)).toBe(true);
  });

  it('keeps the answer on the screen with no sign that it reads again', () => {
    expect(quietly<string>({ state: 'done', value: 'en', refreshing: true })).toEqual({ state: 'done', value: 'en' });
  });

  it('still says that the last read failed', () => {
    const stale = { status: 502, message: 'GitHub is down' };

    expect(quietly<string>({ state: 'done', value: 'en', stale })).toEqual({ state: 'done', value: 'en', stale });
    expect(quietly<string>({ state: 'failed', error: stale })).toEqual({ state: 'failed', error: stale });
  });
});
