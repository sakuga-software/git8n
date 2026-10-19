import { describe, expect, it } from 'vitest';
import { branchUrl, commitUrl, fileUrl, repositoryUrl } from './github';

const repository = {
  owner: 'sakuga-software',
  name: 'detectivebox-front',
  branch: 'main',
  localesPath: 'apps/app/src/assets/locales',
};
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('the pages of GitHub the editor links to', () => {
  it('names the repository, its branch and a commit', () => {
    expect(repositoryUrl(repository)).toBe('https://github.com/sakuga-software/detectivebox-front');
    expect(branchUrl(repository)).toBe('https://github.com/sakuga-software/detectivebox-front/tree/main');
    expect(commitUrl(repository, COMMIT)).toBe(
      `https://github.com/sakuga-software/detectivebox-front/commit/${COMMIT}`,
    );
  });

  /** The branch moves. A link to it would show a text the table did not read. */
  it('names a file at the commit that was read, not at the branch', () => {
    expect(fileUrl(repository, COMMIT, 'en', 'common')).toBe(
      `https://github.com/sakuga-software/detectivebox-front/blob/${COMMIT}/apps/app/src/assets/locales/en/common.json`,
    );
  });

  it('keeps the slashes of a branch, and of a path of the locales', () => {
    expect(branchUrl({ ...repository, branch: 'i18n/en' })).toBe(
      'https://github.com/sakuga-software/detectivebox-front/tree/i18n/en',
    );
    expect(fileUrl({ ...repository, localesPath: 'locales/' }, COMMIT, 'fr', 'letters')).toBe(
      `https://github.com/sakuga-software/detectivebox-front/blob/${COMMIT}/locales/fr/letters.json`,
    );
  });

  /** A row of `i18n_repositories` is written by an admin. A name must not be able to add a query or leave the path. */
  it('encodes what it puts in the path', () => {
    expect(repositoryUrl({ owner: 'a b', name: 'c?d#e' })).toBe('https://github.com/a%20b/c%3Fd%23e');
    expect(branchUrl({ owner: 'o', name: 'n', branch: 'fix/é à' })).toBe(
      'https://github.com/o/n/tree/fix/%C3%A9%20%C3%A0',
    );
  });
});
