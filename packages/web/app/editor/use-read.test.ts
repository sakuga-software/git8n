import { describe, expect, it } from 'vitest';
import { ApiError } from '@i18n-editor/mcp/api';
import { latestOnly, readErrorOf, type Read } from './use-read';

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

const recorder = () => {
  const seen: Array<Read<string>> = [];

  return { seen, start: latestOnly<string>((answer) => seen.push(answer)) };
};

describe('the last read alone answers', () => {
  it('says loading, then the value', async () => {
    const { seen, start } = recorder();
    const english = held<string>();

    start(english.read, 'en');
    english.resolve('en');
    await settled();

    expect(seen).toEqual([{ state: 'loading' }, { state: 'done', value: 'en' }]);
  });

  /**
   * English is slow, and the translator opens German before it answers. The
   * English table must not land under the German header.
   */
  it('drops the answer of a read that a later read replaced', async () => {
    const { seen, start } = recorder();
    const english = held<string>();
    const german = held<string>();

    start(english.read, 'en');
    start(german.read, 'de');
    german.resolve('de');
    await settled();
    english.resolve('en');
    await settled();

    expect(seen).toEqual([{ state: 'loading' }, { state: 'loading' }, { state: 'done', value: 'de' }]);
  });

  it('drops the failure of a read that a later read replaced', async () => {
    const { seen, start } = recorder();
    const english = held<string>();
    const german = held<string>();

    start(english.read, 'en');
    start(german.read, 'de');
    english.reject(new Error('too late'));
    await settled();

    expect(seen.some((answer) => answer.state === 'failed')).toBe(false);
  });

  it('drops the answer of a read that was stopped', async () => {
    const { seen, start } = recorder();
    const english = held<string>();
    const stop = start(english.read, 'en');

    stop();
    english.resolve('en');
    await settled();

    expect(seen).toEqual([{ state: 'loading' }]);
  });

  /** The cleanup of an old effect runs after the new read started. It must not drop the new one. */
  it('keeps the last read when an older one is stopped', async () => {
    const { seen, start } = recorder();
    const english = held<string>();
    const german = held<string>();
    const stopEnglish = start(english.read, 'en');

    start(german.read, 'de');
    stopEnglish();
    german.resolve('de');
    await settled();

    expect(seen.at(-1)).toEqual({ state: 'done', value: 'de' });
  });

  it('reads again when started again, which is what a reload does', async () => {
    const { seen, start } = recorder();
    const first = held<string>();
    const second = held<string>();

    start(first.read, 'en');
    first.reject(new ApiError('{"message":"GitHub answered 502"}', 500));
    await settled();
    start(second.read, 'en');
    second.resolve('en');
    await settled();

    expect(seen.map((answer) => answer.state)).toEqual(['loading', 'failed', 'loading', 'done']);
  });
});

/**
 * After a proposal the page reads again. The table used to leave for a
 * spinner, and the translator lost the place in the list (DB-241).
 */
describe('a read of the same thing keeps what is on the screen', () => {
  it('keeps the last answer while the new one is on its way', async () => {
    const { seen, start } = recorder();
    const first = held<string>();
    const second = held<string>();

    start(first.read, 'en');
    first.resolve('before');
    await settled();
    start(second.read, 'en');

    expect(seen.at(-1)).toEqual({ state: 'done', value: 'before', refreshing: true });
    expect(seen.filter((answer) => answer.state === 'loading')).toHaveLength(1);

    second.resolve('after');
    await settled();

    expect(seen.at(-1)).toEqual({ state: 'done', value: 'after' });
  });

  it('keeps the last answer when the new read fails, and says that it can be out of date', async () => {
    const { seen, start } = recorder();
    const first = held<string>();
    const second = held<string>();

    start(first.read, 'en');
    first.resolve('before');
    await settled();
    start(second.read, 'en');
    second.reject(new ApiError('{"message":"GitHub answered 502"}', 500));
    await settled();

    expect(seen.at(-1)).toEqual({
      state: 'done',
      value: 'before',
      stale: { status: 500, message: 'GitHub answered 502' },
    });
  });

  /** Another language is another thing. Its table must not start with the rows of the language before. */
  it('forgets the last answer for a read of something else', async () => {
    const { seen, start } = recorder();
    const english = held<string>();
    const german = held<string>();

    start(english.read, 'en');
    english.resolve('en');
    await settled();
    start(german.read, 'de');

    expect(seen.at(-1)).toEqual({ state: 'loading' });

    german.reject(new Error('refused'));
    await settled();

    expect(seen.at(-1)).toMatchObject({ state: 'failed' });
  });

  /** Back to English after German: what English said is as old as the visit to German. */
  it('forgets an answer that a read of something else replaced', async () => {
    const { seen, start } = recorder();
    const reads = [held<string>(), held<string>(), held<string>()];

    start(reads[0].read, 'en');
    reads[0].resolve('en');
    await settled();
    start(reads[1].read, 'de');
    reads[1].resolve('de');
    await settled();
    start(reads[2].read, 'en');

    expect(seen.at(-1)).toEqual({ state: 'loading' });
  });

  /** Nothing was ever read: there is nothing to keep, and a dash stays a dash. */
  it('has nothing to keep after a first read that failed', async () => {
    const { seen, start } = recorder();
    const first = held<string>();
    const second = held<string>();

    start(first.read, 'en');
    first.reject(new Error('refused'));
    await settled();
    start(second.read, 'en');

    expect(seen.at(-1)).toEqual({ state: 'loading' });
  });

  it('refreshes from the newest answer, not from the first one', async () => {
    const { seen, start } = recorder();
    const reads = [held<string>(), held<string>(), held<string>()];

    start(reads[0].read, 'en');
    reads[0].resolve('one');
    await settled();
    start(reads[1].read, 'en');
    reads[1].resolve('two');
    await settled();
    start(reads[2].read, 'en');

    expect(seen.at(-1)).toEqual({ state: 'done', value: 'two', refreshing: true });
  });

  it('still drops a late answer of a refresh that a later one replaced', async () => {
    const { seen, start } = recorder();
    const reads = [held<string>(), held<string>(), held<string>()];

    start(reads[0].read, 'en');
    reads[0].resolve('one');
    await settled();
    start(reads[1].read, 'en');
    start(reads[2].read, 'en');
    reads[2].resolve('three');
    await settled();
    reads[1].resolve('two');
    await settled();

    expect(seen.at(-1)).toEqual({ state: 'done', value: 'three' });
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
