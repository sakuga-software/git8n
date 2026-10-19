import { describe, expect, it } from 'vitest';
import { bodyOf, languagesOf, problemsOf, setupReturnOf, withPage, type ConnectForm } from './connect-flow';

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

describe('withPage', () => {
  const row = (owner: string, name: string) => ({ installationId: 1, account: owner, owner, name, private: false });

  it('appends the rows of a page and marks the ones the editor holds', () => {
    expect(withPage([], [row('acme', 'web'), row('acme', 'app')], [{ id: 'r1', owner: 'Acme', name: 'App' }])).toEqual([
      { ...row('acme', 'web'), connectedId: null },
      { ...row('acme', 'app'), connectedId: 'r1' },
    ]);
  });

  /** A repository installed while the admin scrolls moves the next pages by one. */
  it('keeps each repository once when two pages overlap', () => {
    const first = withPage([], [row('acme', 'a'), row('acme', 'b')], []);

    expect(withPage(first, [row('acme', 'B'), row('acme', 'c'), row('acme', 'c')], []).map((r) => r.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
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
  const choice = { installationId: 9, account: 'acme', owner: 'acme', name: 'web', private: true, connectedId: null };

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
