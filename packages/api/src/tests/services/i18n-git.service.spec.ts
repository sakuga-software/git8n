import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@i18n-editor/db';
import { clearI18nCatalogueCache, getCatalogue } from '@/services/i18n-catalogue.service';
import { branchOf, createKeys, propose, proposedKeys, publish, waiting } from '@/services/i18n-git.service';
import { fakeRepo, type FakeRepo } from './fake-github-repo';

/** What the write asked its token for, so the ask itself can be checked. */
const asked: Array<[number, unknown]> = [];

// The GitHub App mints the credential and has its own spec. What the write
// asks for is recorded: a token that carries more than it needs shows in no
// answer.
vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async (installationId: number, scope: unknown) => {
    asked.push([installationId, scope]);

    return 'installation-token';
  },
}));

/**
 * The git path of the translations (DB-212).
 *
 * A proposal is a commit on `i18n/<language>`. A publication is a commit on
 * the base branch. No pull request exists. This pins what those commits hold,
 * and the two ways a publication must refuse.
 */

const LOCALES = 'src/locales';

const repository: I18nRepository = {
  id: 'repo-1',
  installationId: 42,
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  localesPath: LOCALES,
  manifestPath: null,
  languages: ['fr', 'en'],
  createdAt: new Date('2026-09-24T00:00:00Z'),
};

const translator = { name: 'Camille', email: 'camille@users.noreply.invalid' };
const reviewer = { name: 'Dominique', email: 'dominique@users.noreply.invalid' };

const parsed = (repo: FakeRepo, ref: string, path: string) =>
  JSON.parse(repo.filesAt(ref).get(path) ?? '{}') as Record<string, unknown>;

let repo: FakeRepo;

/** The commit a translator read the catalogue at: the head of the base branch. */
const readCommit = () => repo.refs.get('main')!;

const start = (files: Record<string, unknown>) => {
  repo = fakeRepo({ owner: repository.owner, name: repository.name, baseBranch: 'main', files });
  vi.stubGlobal('fetch', repo.fetch);

  return repo;
};

beforeEach(() => {
  asked.length = 0;
  clearI18nCatalogueCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearI18nCatalogueCache();
});

describe('proposing', () => {
  /**
   * A batch of three hundred keys must not be three hundred commits. The
   * contents API writes one file per commit. The git data API is what makes a
   * batch into one commit.
   */
  it('writes a whole batch as one commit, across every file it touches', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir' },
      [`${LOCALES}/fr/admin.json`]: { title: 'Titre' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
      [`${LOCALES}/en/admin.json`]: {},
    });

    const before = repo.commits.size;
    const proposal = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'bye', value: 'Goodbye' },
        { file: 'common', key: 'hello', value: 'Hi' },
        // A second file is what tells a batch apart from a commit per file,
        // which the contents API would have forced.
        { file: 'admin', key: 'title', value: 'Title' },
      ],
      translator,
      readCommit(),
    );

    expect(repo.commits.size).toBe(before + 1);
    expect(proposal.files).toHaveLength(2);
    expect(proposal.branch).toBe('i18n/en');
    expect(repo.refs.get('i18n/en')).toBe(proposal.commit);
    expect(parsed(repo, proposal.commit, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hi', bye: 'Goodbye' });
    expect(parsed(repo, proposal.commit, `${LOCALES}/en/admin.json`)).toEqual({ title: 'Title' });
  });

  /** The base branch is what a reviewer publishes onto. A proposal never touches it. */
  it('leaves the base branch where it was', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const main = repo.refs.get('main');

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());

    expect(repo.refs.get('main')).toBe(main);
  });

  /** git log must say who translated, not only that the App committed. */
  it('names the translator as the author of the commit', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const { commit } = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    expect(repo.commits.get(commit)?.author).toMatchObject(translator);
  });

  /** A key the target holds and the source does not must survive a proposal. */
  it('keeps a key of the file that the batch does not name', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello', kept: 'Kept' },
    });

    const { commit } = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    expect(parsed(repo, commit, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hi', kept: 'Kept' });
  });

  /** A language being started holds no file yet, and proposing is how it starts. */
  it('writes a language the repository holds no file for', async () => {
    start({ [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' } });

    const { commit } = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    expect(parsed(repo, commit, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hi' });
  });

  /** A second batch builds on the first rather than replacing it. */
  it('stacks a second batch on the branch', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { a: 'A', b: 'B' },
      [`${LOCALES}/en/common.json`]: {},
    });

    await propose(repository, 'en', [{ file: 'common', key: 'a', value: 'A!' }], translator, readCommit());

    const second = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'b', value: 'B!' }],
      translator,
      readCommit(),
    );

    expect(parsed(repo, second.commit, `${LOCALES}/en/common.json`)).toEqual({ a: 'A!', b: 'B!' });
    expect(await waiting(repository, 'en')).toHaveLength(2);
  });

  /** Writing is `contents: write`, on this repository and nothing else. */
  it('asks its token for this repository and for writing alone', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: {},
    });

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());

    expect(
      asked.every(
        ([, scope]) =>
          JSON.stringify(scope) ===
          JSON.stringify({
            repository: 'acme-app',
            permissions: { contents: 'write' },
          }),
      ),
    ).toBe(true);
    expect(asked.length).toBeGreaterThan(0);
  });

  /**
   * `__proto__.x` walks to `Object.prototype` and writes there, so every object
   * made afterwards in this process carries the value. The file stays empty,
   * which is what makes it silent.
   */
  it('refuses a key that names a property every object holds', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: {},
    });

    await expect(
      propose(
        repository,
        'en',
        [{ file: 'common', key: '__proto__.polluted', value: 'yes' }],
        translator,
        readCommit(),
      ),
    ).rejects.toThrow(/every object holds/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  /** A key that passes through a value would drop the translation already there. */
  it('refuses a key that passes through a translation', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await expect(
      propose(repository, 'en', [{ file: 'common', key: 'hello.deeper', value: 'x' }], translator, readCommit()),
    ).rejects.toThrow(/the file holds as a value/);
  });

  /**
   * The reader leaves a disabled file out (DB-225). The writer must refuse it
   * too, or a caller that names the file by hand brings it back.
   */
  it('refuses a file the manifest disables, and writes nothing', async () => {
    start({
      [`${LOCALES}/manifest.json`]: { files: { guide: { en: 'disabled' } } },
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/fr/guide.json`]: { title: 'Le carnet' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const before = repo.commits.size;

    await expect(
      propose(
        repository,
        'en',
        [
          { file: 'common', key: 'hello', value: 'Hi' },
          { file: 'guide', key: 'title', value: 'The notebook' },
        ],
        translator,
        readCommit(),
      ),
    ).rejects.toThrow(/guide has no en version/);

    expect(repo.commits.size).toBe(before);
    expect(repo.refs.has('i18n/en')).toBe(false);
  });

  it('writes a file the manifest says is partial', async () => {
    start({
      [`${LOCALES}/manifest.json`]: { files: { guide: { en: 'partial' } } },
      [`${LOCALES}/fr/guide.json`]: { title: 'Le carnet' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'guide', key: 'title', value: 'The notebook' }],
      translator,
      readCommit(),
    );

    expect(parsed(repo, proposal.commit, `${LOCALES}/en/guide.json`)).toEqual({ title: 'The notebook' });
  });

  it('refuses a language the repository does not translate into', async () => {
    start({ [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' } });

    await expect(
      propose(repository, 'de', [{ file: 'common', key: 'hello', value: 'Hallo' }], translator, readCommit()),
    ).rejects.toThrow(/not a language this repository translates into/);
  });

  /** The source is not proposed in: it is what the others are translated from. */
  it('refuses the source language', async () => {
    start({ [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' } });

    await expect(
      propose(repository, 'fr', [{ file: 'common', key: 'hello', value: 'Salut' }], translator, readCommit()),
    ).rejects.toThrow(/not a language this repository translates into/);
  });
});

describe('publishing', () => {
  /** A key is approved with the batch it came from, and lands on the base branch. */
  it('copies an approved key onto the base branch, as one commit', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'common', key: 'bye', value: 'Goodbye' },
      ],
      translator,
      readCommit(),
    );
    const before = repo.commits.size;
    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'bye', commit: proposal.commit }],
      reviewer,
    );

    expect(repo.commits.size).toBe(before + 1);
    expect(published.published).toHaveLength(1);
    expect(published.refused).toHaveLength(0);
    // Only the approved key moved: `hello` keeps what the base said.
    expect(parsed(repo, repo.refs.get('main')!, `${LOCALES}/en/common.json`)).toEqual({
      hello: 'Hello',
      bye: 'Goodbye',
    });
  });

  it('names the reviewer as the author of the publication', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    await publish(repository, 'en', [{ file: 'common', key: 'hello', commit: proposal.commit }], reviewer);

    expect(repo.commits.get(repo.refs.get('main')!)?.author).toMatchObject(reviewer);
  });

  /**
   * The translation answers a text that is no longer there. Publishing it
   * would put an answer beside a question nobody asked, so it goes back to
   * being a proposal.
   */
  it('refuses a key whose source changed since it was proposed', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    // Somebody rewords the source on the base branch after the proposal.
    repo.moveBranch('main', { [`${LOCALES}/fr/common.json`]: { hello: 'Salutations' } });

    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'hello', commit: proposal.commit }],
      reviewer,
    );

    expect(published.commit).toBeNull();
    expect(published.published).toHaveLength(0);
    expect(published.refused).toEqual([
      {
        file: 'common',
        key: 'hello',
        commit: proposal.commit,
        reason: 'source-changed',
        was: 'Bonjour',
        now: 'Salutations',
      },
    ]);
  });

  /**
   * A commit on the branch that this code did not make carries no `Read-at`.
   * Nothing then says what the translation was written against, so the drift
   * cannot be judged — and a key nobody can judge must not be published.
   */
  it('refuses a key from a commit that says no revision', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());

    // Somebody pushes to the branch of the language by hand.
    const byHand = repo.moveBranch('i18n/en', { [`${LOCALES}/en/common.json`]: { hello: 'Hé' } });
    const published = await publish(repository, 'en', [{ file: 'common', key: 'hello', commit: byHand }], reviewer);

    expect(published.commit).toBeNull();
    expect(published.refused[0]).toMatchObject({ key: 'hello', reason: 'no-revision' });
  });

  /**
   * Somebody can change the same file between the read and the write. GitHub
   * refuses the move, and that is the right answer: read again, replay the
   * approved keys on the new content, and never overwrite.
   */
  it('reads again and replays when the base branch moved under it', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', kept: 'Gardé' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    // The first move is refused, as a stale write is. Between the attempts,
    // somebody adds a key to the same file on the base branch.
    repo.refuseNextMoves(1);
    repo.moveBranch('main', { [`${LOCALES}/en/common.json`]: { hello: 'Hello', added: 'Added' } });

    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'hello', commit: proposal.commit }],
      reviewer,
    );

    expect(repo.refusals).toBe(1);
    expect(published.published).toHaveLength(1);
    // The key somebody else added survived: the publication replayed onto it
    // rather than writing the content it had first read.
    expect(parsed(repo, repo.refs.get('main')!, `${LOCALES}/en/common.json`)).toEqual({
      hello: 'Hi',
      added: 'Added',
    });
  });

  it('gives up rather than looping when the base branch keeps moving', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    repo.refuseNextMoves(5);

    await expect(
      publish(repository, 'en', [{ file: 'common', key: 'hello', commit: proposal.commit }], reviewer),
    ).rejects.toThrow(/moved under every attempt/);
    expect(repo.refusals).toBe(2);
  });

  /**
   * The value is read at the approved batch, not at the head. A later batch,
   * or a push by hand, can have changed the key since — publishing the head
   * value would ship something the reviewer never saw, under the revision of
   * the batch they did.
   */
  it('refuses a key the branch changed after the approved batch', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const approvedBatch = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    // A second batch rewrites the same key. The reviewer still names the first.
    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hey' }], translator, readCommit());

    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'hello', commit: approvedBatch.commit }],
      reviewer,
    );

    expect(published.commit).toBeNull();
    expect(published.refused[0]).toMatchObject({ reason: 'changed-since-approval', was: 'Hi', now: 'Hey' });
  });

  /**
   * A trailer of `Read-at: main` would make the source at the trailer the
   * source now, and switch the drift check off for every key of the batch. A
   * revision is forty hexadecimal characters or it is nothing.
   */
  it('refuses a trailer that names a branch rather than a revision', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());

    const forged = repo.moveBranch(
      'i18n/en',
      { [`${LOCALES}/en/common.json`]: { hello: 'Hé' } },
      'i18n(en): 1 key proposed by nobody\n\nRead-at: main',
    );
    const published = await publish(repository, 'en', [{ file: 'common', key: 'hello', commit: forged }], reviewer);

    expect(published.commit).toBeNull();
    expect(published.refused[0]).toMatchObject({ reason: 'no-revision' });
  });

  /** A sha the caller made up names no batch, whatever its message says. */
  it('refuses a commit that is not on the branch of the language', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());

    // The branch was cut from main, so main's head **is** an ancestor of it.
    // A commit made on main afterwards is not, and that is the one to name.
    const elsewhere = repo.moveBranch('main', { [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' } });
    const published = await publish(repository, 'en', [{ file: 'common', key: 'hello', commit: elsewhere }], reviewer);

    expect(published.commit).toBeNull();
    expect(published.refused[0]).toMatchObject({ reason: 'not-on-the-branch' });
  });

  /**
   * `force: false` is the protection, and nothing here forces the refusal: the
   * base branch simply moved, so the commit is no longer built on where it
   * points.
   */
  it('is refused by the repository itself when the base moved, without forcing it', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );

    // Somebody writes another file of the base branch between the read and the
    // write. `publish` reads the base first, so its first attempt is stale.
    let first = true;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (first && (init?.method ?? 'GET') === 'POST' && String(url).endsWith('/git/trees')) {
          first = false;
          repo.moveBranch('main', { [`${LOCALES}/en/other.json`]: { x: 'y' } });
        }

        return repo.fetch(url, init);
      }),
    );

    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'hello', commit: proposal.commit }],
      reviewer,
    );

    expect(repo.refusals).toBeGreaterThan(0);
    expect(published.published).toHaveLength(1);
    expect(parsed(repo, repo.refs.get('main')!, `${LOCALES}/en/other.json`)).toEqual({ x: 'y' });
  });

  /** A key nobody proposed cannot be published by naming it. */
  it('refuses a key the branch does not hold', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hi' }],
      translator,
      readCommit(),
    );
    const published = await publish(
      repository,
      'en',
      [{ file: 'common', key: 'bye', commit: proposal.commit }],
      reviewer,
    );

    expect(published.commit).toBeNull();
    expect(published.refused[0]).toMatchObject({ key: 'bye', reason: 'not-on-the-branch' });
  });

  /**
   * A batch proposed before a file was disabled stays on the branch of its
   * language. Publishing it would put the file back on the base branch.
   */
  it('refuses a key of a file that was disabled after the proposal', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/fr/guide.json`]: { title: 'Le carnet' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    const proposal = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'guide', key: 'title', value: 'The notebook' },
      ],
      translator,
      readCommit(),
    );

    repo.moveBranch('main', { [`${LOCALES}/manifest.json`]: { files: { guide: { en: 'disabled' } } } });

    const published = await publish(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', commit: proposal.commit },
        { file: 'guide', key: 'title', commit: proposal.commit },
      ],
      reviewer,
    );

    expect(published.published.map((row) => row.file)).toEqual(['common']);
    expect(published.refused).toEqual([{ file: 'guide', key: 'title', commit: proposal.commit, reason: 'disabled' }]);
    expect(repo.filesAt(repo.refs.get('main')!).has(`${LOCALES}/en/guide.json`)).toBe(false);
  });

  /** The branch of a language is written by translators. It must not decide what they may write. */
  it('reads the manifest on the base branch, not on the branch of the language', async () => {
    start({
      [`${LOCALES}/manifest.json`]: { files: { guide: { en: 'disabled' } } },
      [`${LOCALES}/fr/guide.json`]: { title: 'Le carnet' },
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
    });

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());
    repo.moveBranch('i18n/en', { [`${LOCALES}/manifest.json`]: { files: {} } });

    await expect(
      propose(repository, 'en', [{ file: 'guide', key: 'title', value: 'The notebook' }], translator, readCommit()),
    ).rejects.toThrow(/guide has no en version/);
  });

  it('refuses to publish a language with no branch at all', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await expect(
      publish(repository, 'en', [{ file: 'common', key: 'hello', commit: 'c0ffee' }], reviewer),
    ).rejects.toThrow(/holds no proposal/);
  });
});

/**
 * A reviewer approves keys, and a batch says nothing of its keys (DB-213).
 * This is the list the editor draws, and what it sends back to `publish`.
 */
describe('the keys that wait on a branch', () => {
  const started = () =>
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir', thanks: 'Merci' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello', bye: 'Bye' },
    });

  it('answers nothing for a language nobody proposed in', async () => {
    started();

    expect(await proposedKeys(repository, 'en')).toEqual([]);
  });

  it('answers each key with its value, what it replaces, its source and its batch', async () => {
    started();

    const proposal = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'thanks', value: 'Thanks' },
        { file: 'common', key: 'hello', value: 'Hi' },
      ],
      translator,
      readCommit(),
    );

    expect(await proposedKeys(repository, 'en')).toEqual([
      expect.objectContaining({
        file: 'common',
        key: 'hello',
        value: 'Hi',
        current: 'Hello',
        source: 'Bonjour',
        commit: proposal.commit,
        author: 'Camille',
        readAt: proposal.readAt,
      }),
      expect.objectContaining({ key: 'thanks', value: 'Thanks', current: null, source: 'Merci' }),
    ]);
  });

  /** `publish` reads the value at the batch it is given. The first batch no longer says what the branch does. */
  it('names the last batch that changed a key', async () => {
    started();

    const first = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'common', key: 'thanks', value: 'Thanks' },
      ],
      translator,
      readCommit(),
    );
    const second = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'hello', value: 'Hey' }],
      translator,
      readCommit(),
    );
    const rows = await proposedKeys(repository, 'en');

    expect(rows.map((row) => [row.key, row.value, row.commit])).toEqual([
      ['hello', 'Hey', second.commit],
      ['thanks', 'Thanks', first.commit],
    ]);
  });

  /**
   * A batch is approved in parts, so « published » belongs to a key. The
   * list of the batches kept a batch with the keys that had already gone.
   */
  it('leaves out a key once the base branch says it, and keeps the rest of its batch', async () => {
    started();

    const proposal = await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'common', key: 'thanks', value: 'Thanks' },
      ],
      translator,
      readCommit(),
    );

    await publish(repository, 'en', [{ file: 'common', key: 'hello', commit: proposal.commit }], reviewer);

    expect((await proposedKeys(repository, 'en')).map((row) => row.key)).toEqual(['thanks']);
  });

  it('answers a key that `publish` then takes with the batch it was given', async () => {
    started();

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());
    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hey' }], translator, readCommit());

    const [row] = await proposedKeys(repository, 'en');
    const published = await publish(repository, 'en', [{ file: row.file, key: row.key, commit: row.commit }], reviewer);

    expect(published.refused).toEqual([]);
    expect(parsed(repo, repo.refs.get('main')!, `${LOCALES}/en/common.json`)).toMatchObject({ hello: 'Hey' });
  });

  /**
   * A batch writes the whole file, as the branch held it. A key that somebody
   * changed on the base branch since must not read as a proposal to change it
   * back.
   */
  it('does not call a key proposed because the base branch changed it since', async () => {
    started();

    await propose(repository, 'en', [{ file: 'common', key: 'hello', value: 'Hi' }], translator, readCommit());
    repo.moveBranch('main', { [`${LOCALES}/en/common.json`]: { hello: 'Hello', bye: 'Goodbye' } });

    expect((await proposedKeys(repository, 'en')).map((row) => row.key)).toEqual(['hello']);
  });

  it('leaves out the keys of a file the manifest disables', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/fr/guide.json`]: { title: 'Le carnet' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    });

    await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'guide', key: 'title', value: 'The notebook' },
      ],
      translator,
      readCommit(),
    );
    repo.moveBranch('main', { [`${LOCALES}/manifest.json`]: { files: { guide: { en: 'disabled' } } } });

    expect((await proposedKeys(repository, 'en')).map((row) => row.file)).toEqual(['common']);
  });

  it('refuses a language the repository does not translate into', async () => {
    started();

    await expect(proposedKeys(repository, 'de')).rejects.toThrow(/not a language this repository translates into/);
  });
});

describe('what is waiting on a branch', () => {
  it('answers nothing for a language nobody proposed in', async () => {
    start({ [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' } });

    expect(await waiting(repository, 'en')).toEqual([]);
  });

  /**
   * The merge base of the branch answers one revision for every batch. The
   * trailer of each commit answers its own, which is what a per-key comparison
   * needs.
   */
  it('carries the revision each batch was written against', async () => {
    start({
      [`${LOCALES}/fr/common.json`]: { a: 'A' },
      [`${LOCALES}/en/common.json`]: {},
    });

    const main = repo.refs.get('main')!;
    const proposal = await propose(
      repository,
      'en',
      [{ file: 'common', key: 'a', value: 'A!' }],
      translator,
      readCommit(),
    );
    const [batch] = await waiting(repository, 'en');

    expect(batch.commit).toBe(proposal.commit);
    expect(batch.readAt).toBe(main);
    expect(batch.author).toBe('Camille');
    expect(batch.message).toContain('1 key proposed by Camille');
  });

  it('names the branch of a language the same way everywhere', () => {
    expect(branchOf('pt-BR')).toBe('i18n/pt-BR');
  });
});

/**
 * A key is added to the source on the base branch (DB-238). It adds, and it
 * never changes: a source text is what every translation of it answers.
 */
describe('creating keys in the source', () => {
  const writer = { name: 'Morgane', email: 'morgane@users.noreply.invalid' };
  const files = () => ({
    [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', buttons: { back: 'Retour' } },
    [`${LOCALES}/fr/admin.json`]: {},
    [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
  });

  it('writes every key as one commit on the base branch, in the source alone', async () => {
    start(files());

    const before = repo.refs.get('main')!;
    const created = await createKeys(
      repository,
      [
        { file: 'common', key: 'buttons.next', value: 'Suivant' },
        { file: 'admin', key: 'analysis.title', value: 'Analyse' },
      ],
      writer,
    );
    const commit = repo.commits.get(repo.refs.get('main')!)!;

    expect(created).toMatchObject({ keys: 2, commit: commit.sha });
    expect(commit.parents).toEqual([before]);
    expect(commit.message).toBe('i18n(fr): 2 keys created by Morgane');
    expect(commit.author).toMatchObject(writer);
    expect(parsed(repo, commit.sha, `${LOCALES}/fr/common.json`)).toEqual({
      hello: 'Bonjour',
      buttons: { back: 'Retour', next: 'Suivant' },
    });
    expect(parsed(repo, commit.sha, `${LOCALES}/fr/admin.json`)).toEqual({ analysis: { title: 'Analyse' } });
    expect(parsed(repo, commit.sha, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hello' });
    expect(repo.refs.has(branchOf('fr'))).toBe(false);
  });

  /** To change a source text is to change what every translation of it answers. */
  it('refuses a key the file holds, and writes nothing', async () => {
    start(files());

    const before = repo.refs.get('main');

    await expect(
      createKeys(
        repository,
        [
          { file: 'common', key: 'buttons.next', value: 'Suivant' },
          { file: 'common', key: 'hello', value: 'Salut' },
        ],
        writer,
      ),
    ).rejects.toThrow(/hello is already in common/);
    expect(repo.refs.get('main')).toBe(before);
  });

  it('refuses a key that names a section the file holds', async () => {
    start(files());

    await expect(
      createKeys(repository, [{ file: 'common', key: 'buttons', value: 'Boutons' }], writer),
    ).rejects.toThrow(/buttons is already in common/);
  });

  it('refuses a key that passes through a text', async () => {
    start(files());

    await expect(
      createKeys(repository, [{ file: 'common', key: 'hello.again', value: 'Rebonjour' }], writer),
    ).rejects.toThrow(/the file holds as a value/);
  });

  it('refuses a key named twice in the batch', async () => {
    start(files());

    await expect(
      createKeys(
        repository,
        [
          { file: 'common', key: 'bye', value: 'Au revoir' },
          { file: 'common', key: 'bye', value: 'Salut' },
        ],
        writer,
      ),
    ).rejects.toThrow(/bye is already in common/);
  });

  /** A file the source does not hold is one the product does not load. */
  it('refuses a file the source does not hold', async () => {
    start(files());

    await expect(createKeys(repository, [{ file: 'missing', key: 'a', value: 'A' }], writer)).rejects.toThrow(
      /missing is not a file of fr\. Known: admin, common/,
    );
  });

  it('refuses a text that says nothing', async () => {
    start(files());

    await expect(createKeys(repository, [{ file: 'common', key: 'blank', value: '   ' }], writer)).rejects.toThrow(
      /blank has no text/,
    );
  });

  it('refuses a key that names a property every object holds', async () => {
    start(files());

    await expect(
      createKeys(repository, [{ file: 'common', key: '__proto__.polluted', value: 'yes' }], writer),
    ).rejects.toThrow(/every object holds/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  /** Somebody adds a key to the same file between the read and the write: both keys are there after. */
  it('reads again and replays when the base branch moved under it', async () => {
    start(files());
    repo.refuseNextMoves(1);
    repo.moveBranch('main', {
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', buttons: { back: 'Retour' }, added: 'Ajouté' },
    });

    await createKeys(repository, [{ file: 'common', key: 'buttons.next', value: 'Suivant' }], writer);

    expect(repo.refusals).toBe(1);
    expect(parsed(repo, repo.refs.get('main')!, `${LOCALES}/fr/common.json`)).toEqual({
      hello: 'Bonjour',
      buttons: { back: 'Retour', next: 'Suivant' },
      added: 'Ajouté',
    });
  });

  it('gives up rather than looping when the base branch keeps moving', async () => {
    start(files());
    repo.refuseNextMoves(5);

    await expect(createKeys(repository, [{ file: 'common', key: 'bye', value: 'Au revoir' }], writer)).rejects.toThrow(
      /moved under every attempt to create keys/,
    );
    expect(repo.refusals).toBe(2);
  });

  /** The catalogue is held for five minutes. Whoever creates a key must see it at once. */
  it('shows the new key as missing in a target at the next read', async () => {
    start(files());

    const before = await getCatalogue(repository, 'en');

    expect(before.entries.map((entry) => entry.key)).not.toContain('bye');

    await createKeys(repository, [{ file: 'common', key: 'bye', value: 'Au revoir' }], writer);

    const after = await getCatalogue(repository, 'en');

    expect(after.entries.find((entry) => entry.key === 'bye')).toMatchObject({ source: 'Au revoir', state: 'missing' });
  });

  it('asks its token for this repository and for writing alone', async () => {
    start(files());
    await createKeys(repository, [{ file: 'common', key: 'bye', value: 'Au revoir' }], writer);

    expect(asked).toContainEqual([42, { repository: 'acme-app', permissions: { contents: 'write' } }]);
  });
});
