import { describe, expect, it } from 'vitest';
import { candidatesOf, sourceFirst, type TreeEntry } from '@/services/i18n-detection.service';

const blobs = (...paths: string[]): TreeEntry[] => paths.map((path) => ({ path, type: 'blob' }));

describe('candidatesOf', () => {
  it('names each folder that holds one folder of locale files for each language', () => {
    expect(
      candidatesOf(
        blobs(
          'app/locales/fr/common.json',
          'app/locales/en/common.json',
          'app/locales/en/admin.json',
          'i18n/de/a.json',
        ),
      ),
    ).toEqual([
      { path: 'app/locales', languages: ['en', 'fr'] },
      { path: 'i18n', languages: ['de'] },
    ]);
  });

  /** `components/button/props.json` must not read as a language named `button`. */
  it('leaves out a folder whose children are not named as languages', () => {
    expect(candidatesOf(blobs('src/components/button/props.json', 'src/config/app.json'))).toEqual([]);
  });

  it('reads tags with a region or a script', () => {
    expect(candidatesOf(blobs('l/pt-BR/a.json', 'l/zh_Hant/a.json'))[0]?.languages).toEqual(['pt-BR', 'zh_Hant']);
  });

  /** The row needs a path, and a file a proposal cannot name is left out of the catalogue too. */
  it('leaves out the root of the repository and the files that no proposal can name', () => {
    expect(candidatesOf(blobs('fr/common.json', 'l/en/common.v2.json', 'l/en/notes.txt'))).toEqual([]);
  });

  it('ignores folders and submodules, which carry no file of their own', () => {
    expect(
      candidatesOf([
        { path: 'l/fr', type: 'tree' },
        { path: 'l/en/x.json', type: 'commit' },
      ]),
    ).toEqual([]);
  });

  it('puts the folder with the most languages first, then sorts by path', () => {
    expect(
      candidatesOf(blobs('b/fr/a.json', 'a/fr/a.json', 'c/fr/a.json', 'c/en/a.json')).map((row) => row.path),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('sourceFirst', () => {
  it('moves the source to the front and keeps the others in their order', () => {
    expect(sourceFirst(['de', 'en', 'fr'], 'fr')).toEqual(['fr', 'de', 'en']);
  });

  it('changes nothing for a source that is not among the languages, or none', () => {
    expect(sourceFirst(['de', 'en'], 'fr')).toEqual(['de', 'en']);
    expect(sourceFirst(['de', 'en'], null)).toEqual(['de', 'en']);
  });
});
