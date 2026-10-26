import { describe, expect, it } from 'vitest';
import type { Repository } from '@i18n-editor/mcp/api';
import { changeOf, fieldOfIssue, formOf, previewOf, problemsOf } from './form';

const repository: Repository = {
  id: 'repo-1',
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  localesPath: 'src/locales',
  manifestPath: 'src/locales/manifest.json',
  publishMode: 'commit',
  proposalCommitTemplate: null,
  publicationCommitTemplate: null,
  pullRequestTitleTemplate: 'Translations: {count_keys}',
  pullRequestBodyTemplate: null,
  source: 'fr',
  targets: ['en', 'de'],
};

describe('formOf', () => {
  it('writes the languages source first, and an empty field for a default format', () => {
    const form = formOf(repository);

    expect(form.languages).toBe('fr, en, de');
    expect(form.proposalCommit).toBe('');
    expect(form.pullRequestTitle).toBe('Translations: {count_keys}');
  });

  it('reads a repository of an API older than DB-609 as the defaults', () => {
    const { proposalCommitTemplate: _a, pullRequestTitleTemplate: _b, publishMode: _c, ...old } = repository;

    expect(formOf(old as Repository)).toMatchObject({ publishMode: 'commit', pullRequestTitle: '' });
  });
});

describe('changeOf', () => {
  const before = formOf(repository);

  it('sends nothing when nothing changed', () => {
    expect(changeOf(before, { ...before, branch: ' main ', languages: 'fr,en,  de' })).toEqual({});
  });

  it('sends only the fields that changed', () => {
    expect(
      changeOf(before, { ...before, publishMode: 'pull_request', proposalCommit: 'i18n({language}): {count_keys}' }),
    ).toEqual({ publishMode: 'pull_request', proposalCommitTemplate: 'i18n({language}): {count_keys}' });
  });

  it('sends null for a format set back to its default, typed out or emptied', () => {
    expect(changeOf(before, { ...before, pullRequestTitle: '' })).toEqual({ pullRequestTitleTemplate: null });
    expect(changeOf(before, { ...before, pullRequestTitle: 'i18n: {count_keys} published ({languages})' })).toEqual({
      pullRequestTitleTemplate: null,
    });
  });

  it('sends null for an emptied manifest, and a folder with no slash at its end', () => {
    expect(changeOf(before, { ...before, manifestPath: ' ', localesPath: 'locales/' })).toEqual({
      manifestPath: null,
      localesPath: 'locales',
    });
  });

  it('sends the languages in their new order', () => {
    expect(changeOf(before, { ...before, languages: 'en, fr, de' })).toEqual({ languages: ['en', 'fr', 'de'] });
  });
});

describe('problemsOf', () => {
  const form = formOf(repository);

  it('finds nothing in a repository as the API answers it', () => {
    expect(problemsOf(form)).toEqual({});
  });

  it('says in French which variable a format does not know', () => {
    expect(problemsOf({ ...form, pullRequestTitle: 'by {author}' }).pullRequestTitle).toBe(
      "{author} n'est pas une variable de ce message. Variables : {count}, {count_keys}, {languages}, {repository}, {branch}.",
    );
  });

  it('refuses a second line in a commit, and takes it in the body of the pull request', () => {
    expect(problemsOf({ ...form, publicationCommit: 'a\nb' }).publicationCommit).toBe(
      'Ce message tient sur une ligne.',
    );
    expect(problemsOf({ ...form, pullRequestBody: 'a\n\n{keys_list}' })).toEqual({});
  });

  it('keeps the rules of the connection for the place of the locales', () => {
    expect(problemsOf({ ...form, localesPath: '../up', languages: '' })).toMatchObject({
      localesPath: 'Le chemin ne peut pas sortir du dépôt.',
      languages: 'Indiquez au moins la langue source.',
    });
  });
});

describe('previewOf', () => {
  it('writes the example values into the format', () => {
    expect(previewOf('pullRequestTitle', '[{repository}] {count_keys}')).toBe('[acme/acme-app] 4 keys');
  });

  it('shows the default format for an empty field, and for a format it refuses', () => {
    expect(previewOf('proposalCommit', '')).toBe('i18n(en): 3 keys proposed by Ada Lovelace');
    expect(previewOf('proposalCommit', '{nope}')).toBe('i18n(en): 3 keys proposed by Ada Lovelace');
  });
});

describe('fieldOfIssue', () => {
  it('names the field of the page that a field of the API names', () => {
    expect(fieldOfIssue('pullRequestTitleTemplate')).toBe('pullRequestTitle');
    expect(fieldOfIssue('branch')).toBe('branch');
    expect(fieldOfIssue('installationId')).toBeNull();
  });
});
