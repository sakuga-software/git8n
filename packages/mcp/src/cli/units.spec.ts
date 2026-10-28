import { describe, expect, it } from 'vitest';
import { ERRORS, EXIT } from './errors.ts';
import { textsOf } from './keys.ts';
import { githubSlugsOf } from './repository.ts';

describe('the GitHub remotes of a folder', () => {
  it('reads the forms of an address of git', () => {
    expect(
      githubSlugsOf([
        'git@github.com:Acme/App.git',
        'https://github.com/acme/app',
        'ssh://git@github.com/acme/site.git/',
        'https://gitlab.com/acme/other.git',
      ]),
    ).toEqual(['acme/app', 'acme/site']);
  });
});

describe('the input of apply', () => {
  const ids = (input: unknown, file?: string) => Object.fromEntries(textsOf(JSON.stringify(input), file));

  it('reads ids, files at the top, and the keys of --file, nested or dotted', () => {
    expect(ids({ 'common:a.b': 'x' })).toEqual({ 'common:a.b': 'x' });
    expect(ids({ common: { a: { b: 'x' } } })).toEqual({ 'common:a.b': 'x' });
    expect(ids({ a: { b: 'x' }, 'c.d': 'y' }, 'menu')).toEqual({ 'menu:a.b': 'x', 'menu:c.d': 'y' });
  });

  it('refuses what is not a text', () => {
    expect(() => textsOf('[]')).toThrow(/JSON object/);
    expect(() => textsOf('{')).toThrow(/not JSON/);
    expect(() => ids({ hello: 'x' })).toThrow(/names no file/);
    expect(() => ids({ 'common:a': 3 })).toThrow(/not a text/);
    expect(() => ids({ common: { a: [1] } })).toThrow(/not a text/);
  });
});

describe('the codes of the errors', () => {
  it('gives each code an exit status of the documented table', () => {
    for (const [code, error] of Object.entries(ERRORS)) {
      expect(code).toMatch(/^I18NE\d{4}$/);
      expect(Object.values(EXIT)).toContain(error.exit);
    }
  });
});
