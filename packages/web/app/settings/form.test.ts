import { describe, expect, it } from 'vitest';
import type { Repository } from '@i18n-editor/mcp/api';
import {
  changeOf,
  fieldOfIssue,
  firstSectionWith,
  formOf,
  previewOf,
  problemsOf,
  sectionOf,
  sectionsFor,
  SETTINGS_SECTIONS,
} from './form';

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
  it('names a field of the page for each field that changeOf sends', () => {
    const before = formOf(repository);
    const after = {
      ...before,
      branch: 'develop',
      languages: 'fr, de',
      publishMode: 'pull_request' as const,
      pullRequestTitle: '',
    };

    expect(Object.keys(changeOf(before, after)).map(fieldOfIssue)).toEqual([
      'branch',
      'languages',
      'publishMode',
      'pullRequestTitle',
    ]);
  });

  it('names the field of the page that a field of the API names', () => {
    expect(fieldOfIssue('pullRequestTitleTemplate')).toBe('pullRequestTitle');
    expect(fieldOfIssue('branch')).toBe('branch');
    expect(fieldOfIssue('installationId')).toBeNull();
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('puts each field of the page in one section, and in one only', () => {
    const fields = SETTINGS_SECTIONS.flatMap((section) => section.fields);

    expect([...fields].sort()).toEqual(Object.keys(formOf(repository)).sort());
  });
});

describe('sectionOf', () => {
  it('opens the section that the address names', () => {
    expect(sectionOf('messages')).toBe('messages');
  });

  it('opens the first section when the address names none, or one that does not exist', () => {
    expect(sectionOf(null)).toBe('repository');
    expect(sectionOf('nothing')).toBe('repository');
  });

  /** An owner who is not an admin manages the members, and opens no other section (DB-637). */
  it('opens the members for an owner, whatever the address names', () => {
    const owner = sectionsFor(false);

    expect(owner.map((section) => section.id)).toEqual(['members']);
    expect(sectionOf('repository', owner)).toBe('members');
    expect(sectionOf(null, owner)).toBe('members');
    expect(sectionsFor(true).map((section) => section.id)).toEqual([
      'repository',
      'publication',
      'messages',
      'members',
    ]);
  });
});

describe('firstSectionWith', () => {
  it('names the first section in the order of the tabs, whatever the order of the fields', () => {
    expect(firstSectionWith(['pullRequestTitle', 'publishMode'])).toBe('publication');
  });

  it('names no section for no field', () => {
    expect(firstSectionWith([])).toBeNull();
  });
});
