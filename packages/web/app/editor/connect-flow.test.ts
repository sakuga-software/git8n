import { describe, expect, it } from 'vitest';
import type { Installation } from '@i18n-editor/mcp/api';
import { bodyOf, choicesOf, languagesOf, problemsOf, setupReturnOf, type ConnectForm } from './connect-flow';

describe('setupReturnOf', () => {
  it('reads the installation and the action that GitHub sends back', () => {
    expect(setupReturnOf('?installation_id=123&setup_action=install')).toEqual({
      installationId: 123,
      action: 'install',
    });
    expect(setupReturnOf('?installation_id=7&setup_action=update')).toEqual({ installationId: 7, action: 'update' });
  });

  it('answers nothing for an address that is not a return of GitHub', () => {
    expect(setupReturnOf('')).toEqual({ installationId: null, action: null });
    expect(setupReturnOf('?installation_id=abc&setup_action=delete')).toEqual({ installationId: null, action: null });
  });
});

describe('choicesOf', () => {
  const installations: Installation[] = [
    {
      id: 1,
      account: 'acme',
      repositories: [
        { owner: 'acme', name: 'web' },
        { owner: 'acme', name: 'app' },
      ],
    },
    {
      id: 2,
      account: 'beta',
      repositories: [
        { owner: 'beta', name: 'site' },
        { owner: 'acme', name: 'web' },
      ],
    },
  ];

  it('puts the repositories that are not connected first, and shows a repository once', () => {
    expect(choicesOf(installations, [{ id: 'r1', owner: 'acme', name: 'app' }])).toEqual([
      { installationId: 1, owner: 'acme', name: 'web', connectedId: null },
      { installationId: 2, owner: 'beta', name: 'site', connectedId: null },
      { installationId: 1, owner: 'acme', name: 'app', connectedId: 'r1' },
    ]);
  });

  it('puts the installation that GitHub just named before the others', () => {
    expect(choicesOf(installations, [], 2).map((choice) => choice.name)).toEqual(['site', 'app', 'web']);
  });

  it('knows a connected repository whatever the case of its name', () => {
    expect(choicesOf(installations, [{ id: 'r', owner: 'Acme', name: 'Web' }])[2]).toMatchObject({
      name: 'web',
      connectedId: 'r',
    });
  });
});

describe('languagesOf', () => {
  it('reads the languages in the order typed, each once, whatever separates them', () => {
    expect(languagesOf(' fr, en ;pt-BR  en ')).toEqual(['fr', 'en', 'pt-BR']);
    expect(languagesOf('  ')).toEqual([]);
  });
});

const form = (fields: Partial<ConnectForm> = {}): ConnectForm => ({
  branch: 'main',
  localesPath: 'src/locales',
  manifestPath: '',
  languages: 'fr, en',
  ...fields,
});

describe('problemsOf', () => {
  it('finds nothing wrong in a complete form', () => {
    expect(problemsOf(form())).toEqual({});
  });

  it('names each field that is empty', () => {
    expect(Object.keys(problemsOf(form({ branch: ' ', localesPath: '', languages: '' })))).toEqual([
      'branch',
      'localesPath',
      'languages',
    ]);
  });

  it('refuses the paths that climb out of the repository, as the API does', () => {
    expect(problemsOf(form({ localesPath: 'a/../b', branch: 'x/..', manifestPath: '../m.json' }))).toMatchObject({
      localesPath: expect.any(String),
      branch: expect.any(String),
      manifestPath: expect.any(String),
    });
  });

  it('refuses a manifest that is not a .json file and a language that is not a tag', () => {
    expect(problemsOf(form({ manifestPath: 'locales/manifest.yaml', languages: 'fr, en/US' }))).toMatchObject({
      manifestPath: expect.any(String),
      languages: expect.any(String),
    });
  });
});

describe('bodyOf', () => {
  const choice = { installationId: 9, owner: 'acme', name: 'web', connectedId: null };

  it('sends no manifest when the field is empty, and no slash at the end of the folder', () => {
    expect(bodyOf(choice, form({ localesPath: 'src/locales/ ' }))).toEqual({
      installationId: 9,
      owner: 'acme',
      name: 'web',
      branch: 'main',
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
    });
  });

  it('sends the manifest that was typed', () => {
    expect(bodyOf(choice, form({ manifestPath: 'i18n.json' }))).toMatchObject({ manifestPath: 'i18n.json' });
  });
});
