import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@i18n-editor/db';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { createKeys, propose, proposedKeys, publish } from '@/services/i18n-git.service';
import {
  describePull,
  lastPullOf,
  MissingPermissionError,
  PUBLISH_BRANCH,
  PublishConflictError,
} from '@/services/i18n-pull-request.service';
import { fakeRepo, type FakeRepo } from './fake-github-repo';

/** What the writes asked their token for. */
const asked: Array<[number, unknown]> = [];

/** The installation has not accepted `pull_requests: write` yet: GitHub refuses the token with 422. */
let permissionMissing = false;

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return {
    ...real,
    installationToken: async (installationId: number, scope: { permissions?: Record<string, string> }) => {
      asked.push([installationId, scope]);

      if (permissionMissing && scope.permissions?.pull_requests) {
        throw new real.GithubError(
          'GitHub answered 422 for /app/installations/42/access_tokens — The permissions requested are not granted to this installation.',
          422,
        );
      }

      return 'installation-token';
    },
  };
});

/**
 * Publishing through a pull request (DB-606).
 *
 * A repository whose base branch requires a pull request publishes on
 * `i18n/publish`, and one pull request takes it to the base branch.
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
  publishMode: 'pull_request',
  proposalCommitTemplate: null,
  publicationCommitTemplate: null,
  pullRequestTitleTemplate: null,
  pullRequestBodyTemplate: null,
  createdAt: new Date('2026-10-26T00:00:00Z'),
};

const translator = { name: 'Camille', email: 'camille@users.noreply.invalid' };
const reviewer = { name: 'Dominique', email: 'dominique@users.noreply.invalid' };

let repo: FakeRepo;

const parsed = (ref: string, path: string) =>
  JSON.parse(repo.filesAt(repo.refs.get(ref) ?? ref).get(path) ?? '{}') as Record<string, unknown>;

const start = () => {
  repo = fakeRepo({
    owner: repository.owner,
    name: repository.name,
    baseBranch: 'main',
    files: {
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir', yes: 'Oui' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    },
  });
  vi.stubGlobal('fetch', repo.fetch);
};

/** Proposes keys in English, and answers the batch commit. */
const proposeEn = async (values: Array<{ key: string; value: string }>) =>
  (
    await propose(
      repository,
      'en',
      values.map((row) => ({ file: 'common', ...row })),
      translator,
      repo.refs.get('main')!,
    )
  ).commit;

beforeEach(() => {
  asked.length = 0;
  permissionMissing = false;
  clearI18nCatalogueCache();
  start();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearI18nCatalogueCache();
});

describe('a publication in the mode pull_request', () => {
  it('commits on i18n/publish, opens a pull request to the base branch, and leaves the base branch alone', async () => {
    const before = repo.refs.get('main');
    const batch = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    const publication = await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer);

    expect(repo.refs.get('main')).toBe(before);
    expect(publication.commit).toBe(repo.refs.get(PUBLISH_BRANCH));
    expect(parsed(PUBLISH_BRANCH, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hello', bye: 'Goodbye' });
    expect(publication.pullRequest).toEqual({
      number: 1,
      url: 'https://github.com/acme/acme-app/pull/1',
      state: 'open',
      mergeable: null,
    });
    expect(repo.pulls.get(1)).toMatchObject({
      head: PUBLISH_BRANCH,
      base: 'main',
      title: 'i18n: 1 key published (en)',
    });
    expect(repo.pulls.get(1)?.body).toContain('- `common:bye`');
  });

  it('asks its token for pull_requests: write, and the mode commit does not', async () => {
    const batch = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer);
    await publish(
      { ...repository, publishMode: 'commit' },
      'en',
      [{ file: 'common', key: 'bye', commit: batch }],
      reviewer,
    );

    const scopes = asked.map(([, scope]) => scope);

    expect(scopes).toContainEqual({
      repository: 'acme-app',
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    expect(scopes.at(-1)).toEqual({ repository: 'acme-app', permissions: { contents: 'write' } });
  });

  it('adds a second publication to the open pull request, and writes its title and body again', async () => {
    const first = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: first }], reviewer);

    const second = await proposeEn([{ key: 'yes', value: 'Yes' }]);
    const publication = await publish(repository, 'en', [{ file: 'common', key: 'yes', commit: second }], reviewer);

    expect(repo.pulls.size).toBe(1);
    expect(publication.pullRequest?.number).toBe(1);
    // The first key stays: the second commit is built on the branch, not on the base.
    expect(parsed(PUBLISH_BRANCH, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hello', bye: 'Goodbye', yes: 'Yes' });
    expect(repo.pulls.get(1)?.title).toBe('i18n: 2 keys published (en)');
    expect(repo.pulls.get(1)?.body).toContain('- `common:yes`');
  });

  it('starts i18n/publish again from the base branch after a merge, and opens a new pull request', async () => {
    const first = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: first }], reviewer);
    repo.mergePull(1);

    const second = await proposeEn([{ key: 'yes', value: 'Yes' }]);
    const publication = await publish(repository, 'en', [{ file: 'common', key: 'yes', commit: second }], reviewer);
    const head = repo.commits.get(repo.refs.get(PUBLISH_BRANCH)!)!;

    expect(publication.pullRequest?.number).toBe(2);
    expect(head.parents).toEqual([repo.refs.get('main')]);
    expect(repo.pulls.get(2)?.title).toBe('i18n: 1 key published (en)');
  });

  it('starts again from the base branch after a close, and drops what the closed pull request held', async () => {
    const first = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: first }], reviewer);
    repo.closePull(1);

    const second = await proposeEn([{ key: 'yes', value: 'Yes' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'yes', commit: second }], reviewer);

    expect(parsed(PUBLISH_BRANCH, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hello', yes: 'Yes' });
    expect(repo.pulls.get(2)?.state).toBe('open');
  });

  it('takes the base branch in when it moved, and keeps what the open pull request holds', async () => {
    const first = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: first }], reviewer);
    repo.moveBranch('main', { 'README.md': 'a change of the code' });

    const second = await proposeEn([{ key: 'yes', value: 'Yes' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'yes', commit: second }], reviewer);

    const files = repo.filesAt(repo.refs.get(PUBLISH_BRANCH)!);

    expect(files.has('README.md')).toBe(true);
    expect(parsed(PUBLISH_BRANCH, `${LOCALES}/en/common.json`)).toEqual({ hello: 'Hello', bye: 'Goodbye', yes: 'Yes' });
    expect(repo.pulls.size).toBe(1);
  });

  it('reports a conflict with the base branch, and forces nothing', async () => {
    const first = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: first }], reviewer);

    const held = repo.refs.get(PUBLISH_BRANCH);

    repo.moveBranch('main', { [`${LOCALES}/en/common.json`]: { hello: 'Hello', bye: 'Bye' } });
    repo.refuse.mergeConflict = true;

    const second = await proposeEn([{ key: 'yes', value: 'Yes' }]);

    await expect(
      publish(repository, 'en', [{ file: 'common', key: 'yes', commit: second }], reviewer),
    ).rejects.toBeInstanceOf(PublishConflictError);
    expect(repo.refs.get(PUBLISH_BRANCH)).toBe(held);
  });

  it('names the permission when the installation has not accepted pull_requests: write', async () => {
    const batch = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    permissionMissing = true;

    const refused = publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer);

    await expect(refused).rejects.toBeInstanceOf(MissingPermissionError);
    await expect(refused).rejects.toThrow(/Pull requests: write/);
  });

  it('names the permission when GitHub refuses the pull request itself', async () => {
    const batch = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    repo.refuse.pulls = true;

    await expect(
      publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer),
    ).rejects.toBeInstanceOf(MissingPermissionError);
  });
});

describe('the proposals of a repository that publishes through a pull request', () => {
  it('leaves out a key that waits in the open pull request, and lists it again after a close', async () => {
    const batch = await proposeEn([
      { key: 'bye', value: 'Goodbye' },
      { key: 'yes', value: 'Yes' },
    ]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer);

    expect((await proposedKeys(repository, 'en')).map((row) => row.key)).toEqual(['yes']);

    repo.closePull(1);

    expect((await proposedKeys(repository, 'en')).map((row) => row.key)).toEqual(['bye', 'yes']);
  });
});

describe('the creation of keys in the mode pull_request', () => {
  it('writes the keys on i18n/publish, in the pull request, and refuses a key it already holds', async () => {
    const created = await createKeys(repository, [{ file: 'common', key: 'no', value: 'Non' }], reviewer);

    expect(created.pullRequest?.number).toBe(1);
    expect(parsed(PUBLISH_BRANCH, `${LOCALES}/fr/common.json`)).toMatchObject({ no: 'Non' });
    expect(parsed('main', `${LOCALES}/fr/common.json`)).not.toHaveProperty('no');

    await expect(createKeys(repository, [{ file: 'common', key: 'no', value: 'Non' }], reviewer)).rejects.toThrow(
      /already in common/,
    );
  });
});

describe('the last pull request', () => {
  it('answers it open with whether it merges, then merged after the merge', async () => {
    const batch = await proposeEn([{ key: 'bye', value: 'Goodbye' }]);

    await publish(repository, 'en', [{ file: 'common', key: 'bye', commit: batch }], reviewer);

    expect(await lastPullOf(repository, 'installation-token')).toMatchObject({
      number: 1,
      state: 'open',
      mergeable: true,
    });

    repo.mergePull(1);

    expect(await lastPullOf(repository, 'installation-token')).toMatchObject({
      number: 1,
      state: 'merged',
      mergeable: null,
    });
  });

  it('answers nothing before the first publication', async () => {
    expect(await lastPullOf(repository, 'installation-token')).toBeNull();
  });
});

describe('describePull', () => {
  it('counts the keys of every publication commit, and leaves the merges of the base branch out', () => {
    const described = describePull(
      [
        'i18n(en): 2 keys published by Dominique\n\n- en common:a\n- en common:b',
        'Merge main into i18n/publish',
        'i18n(de): 1 key published by Dominique\n\n- de admin:c',
        'i18n(en): 1 key published by Dominique\n\n- en common:a',
      ],
      repository,
    );

    expect(described.title).toBe('i18n: 3 keys published (de, en)');
    expect(described.body).toContain('### de');
    expect(described.body).toContain('- `admin:c`');
  });

  it('counts the keys of a commit whose subject the repository formats its own way (DB-609)', () => {
    const described = describePull(['Translations (en) by Dominique\n\n- en common:a\n- en common:b'], repository);

    expect(described.title).toBe('i18n: 2 keys published (en)');
  });

  it('writes the title and the body in the formats of the repository (DB-609)', () => {
    const described = describePull(['i18n(en): 1 key published by D\n\n- en common:a'], {
      ...repository,
      pullRequestTitleTemplate: '[{repository}] {count_keys} for {languages} into {branch}',
      pullRequestBodyTemplate: 'Read before you merge.\n\n{keys_list}',
    });

    expect(described.title).toBe('[acme/acme-app] 1 key for en into main');
    expect(described.body).toBe('Read before you merge.\n\n### en\n\n- `common:a`');
  });

  it('adds the keys a long commit only counted', () => {
    expect(describePull(['i18n(en): 105 keys published by D\n\n- en common:a\n… and 104 more'], repository).title).toBe(
      'i18n: 105 keys published (en)',
    );
  });
});
