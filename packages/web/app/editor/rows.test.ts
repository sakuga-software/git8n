import { describe, expect, it } from 'vitest';
import type { Catalogue, ProposedKey } from '@i18n-editor/mcp/api';
import {
  accessOf,
  afterProposal,
  afterPublication,
  countsOf,
  openOf,
  pageNumbersOf,
  shareOf,
  draftsAfterProposal,
  filesIn,
  idOf,
  linesOf,
  matching,
  matchIn,
  neighboursOf,
  newKeyProblem,
  pageOf,
  type Row,
  rowsOf,
  SUGGESTIONS_SHOWN,
  suggestionsOf,
  withPublished,
  withWrites,
} from './rows';

const catalogue: Catalogue = {
  repository: 'repo-1',
  language: 'en',
  source: 'fr',
  commit: 'a'.repeat(40),
  entries: [
    { file: 'common', key: 'hello', source: 'Bonjour', value: 'Hello', state: 'translated' },
    { file: 'common', key: 'bye', source: 'Au revoir', value: null, state: 'missing' },
    { file: 'admin', key: 'title', source: 'Titre', value: null, state: 'missing' },
    { file: 'admin', key: 'save', source: 'Enregistrer', value: 'Save', state: 'translated' },
  ],
  files: { admin: 'available', common: 'partial', guide: 'disabled' },
};

const proposal = (file: string, key: string, value: string): ProposedKey => ({
  file,
  key,
  value,
  current: null,
  source: null,
  commit: 'c'.repeat(40),
  author: 'Camille',
  at: '2026-10-06T10:00:00Z',
  readAt: 'a'.repeat(40),
});

describe('the rows of the table', () => {
  it('shows the missing keys first, then the proposed, then the published', () => {
    const rows = rowsOf(catalogue, [proposal('common', 'bye', 'Goodbye')]);

    expect(rows.map((row) => [row.state, row.file, row.key])).toEqual([
      ['missing', 'admin', 'title'],
      ['proposed', 'common', 'bye'],
      ['published', 'admin', 'save'],
      ['published', 'common', 'hello'],
    ]);
  });

  /** A key the base branch says can have a new value waiting: the work is on the proposal. */
  it('calls a published key proposed when a batch waits for it', () => {
    const [row] = rowsOf(catalogue, [proposal('common', 'hello', 'Hi')]).filter((entry) => entry.key === 'hello');

    expect(row).toMatchObject({ state: 'proposed', published: 'Hello' });
    expect(row.proposal?.value).toBe('Hi');
  });

  it('leaves out a proposal for a key the source no longer holds', () => {
    const rows = rowsOf(catalogue, [proposal('common', 'gone', 'Gone')]);

    expect(rows).toHaveLength(4);
    expect(rows.some((row) => row.key === 'gone')).toBe(false);
  });

  it('counts each state', () => {
    expect(countsOf(rowsOf(catalogue, [proposal('common', 'bye', 'Goodbye')]))).toEqual({
      missing: 1,
      review: 0,
      proposed: 1,
      published: 2,
    });
  });

  /** A translation whose source changed is to read again (DB-607). */
  it('puts a translation to read again after the missing keys, with the source it answers', () => {
    const changed: Catalogue = {
      ...catalogue,
      entries: catalogue.entries.map((entry) =>
        entry.key === 'hello' ? { ...entry, source: 'Salut', state: 'review' as const, was: 'Bonjour' } : entry,
      ),
    };
    const rows = rowsOf(changed, []);

    expect(rows.map((row) => [row.state, row.key])).toEqual([
      ['missing', 'title'],
      ['missing', 'bye'],
      ['review', 'hello'],
      ['published', 'save'],
    ]);
    expect(rows.find((row) => row.key === 'hello')).toMatchObject({
      was: 'Bonjour',
      source: 'Salut',
      published: 'Hello',
    });
    expect(countsOf(rows)).toMatchObject({ review: 1, published: 1 });
  });

  /** A new proposal answers the new source: the row is proposed, and no longer to read again. */
  it('calls a translation to read again proposed when a new value waits for it', () => {
    const changed: Catalogue = {
      ...catalogue,
      entries: catalogue.entries.map((entry) =>
        entry.key === 'hello' ? { ...entry, state: 'review' as const, was: 'Bonjour' } : entry,
      ),
    };

    expect(rowsOf(changed, [proposal('common', 'hello', 'Hi')]).find((row) => row.key === 'hello')).toMatchObject({
      state: 'proposed',
      was: null,
    });
  });

  it('names the files the manifest holds back', () => {
    expect(filesIn(catalogue, 'disabled')).toEqual(['guide']);
    expect(filesIn(catalogue, 'partial')).toEqual(['common']);
    expect(filesIn({ ...catalogue, files: undefined }, 'disabled')).toEqual([]);
  });

  it('shows a value that was just published before the catalogue says it', () => {
    const patched = withPublished(catalogue, new Map([[idOf({ file: 'common', key: 'bye' }), 'Goodbye']]));

    expect(rowsOf(patched, []).find((row) => row.key === 'bye')).toMatchObject({
      state: 'published',
      published: 'Goodbye',
    });
  });
});

describe('what an account can do', () => {
  const targets = ['en', 'de'];

  /** The source is a language of its own in the list, and written by `writes_source` alone (DB-607). */
  it('lists the source first, and lets only an account that writes the source write it', () => {
    const writer = accessOf(
      { admin: false, rights: { languages: [], role: 'translator', writesSource: true } },
      targets,
      'fr',
    );
    const reviewer = accessOf({ admin: false, rights: { languages: ['en', 'fr'], role: 'reviewer' } }, targets, 'fr');

    expect(writer.languages).toEqual(['fr', 'en', 'de']);
    expect(writer.mayPropose('fr')).toBe(true);
    expect(writer.mayPublish('fr')).toBe(true);
    expect(reviewer.languages).toEqual(['fr', 'en']);
    expect(reviewer.mayPropose('fr')).toBe(false);
    expect(reviewer.mayPublish('fr')).toBe(false);
  });

  it('lets a reviewer of a language keep its translations, and nobody keep the source', () => {
    const reviewer = accessOf({ admin: false, rights: { languages: ['en'], role: 'reviewer' } }, targets, 'fr');
    const translator = accessOf({ admin: false, rights: { languages: ['en'], role: 'translator' } }, targets, 'fr');

    expect(reviewer.mayReview('en')).toBe(true);
    expect(reviewer.mayReview('de')).toBe(false);
    expect(reviewer.mayReview('fr')).toBe(false);
    expect(translator.mayReview('en')).toBe(false);
  });

  it('lets an admin with no grant read every language and write none', () => {
    const access = accessOf({ admin: true, rights: null }, targets);

    expect(access.languages).toEqual(['en', 'de']);
    expect(access.mayPropose('en')).toBe(false);
    expect(access.mayPublish('en')).toBe(false);
  });

  it('offers a translator the languages of the grant, and no publication', () => {
    const access = accessOf({ admin: false, rights: { languages: ['de'], role: 'translator' } }, targets);

    expect(access.languages).toEqual(['de']);
    expect(access.mayPropose('de')).toBe(true);
    expect(access.mayPropose('en')).toBe(false);
    expect(access.mayPublish('de')).toBe(false);
  });

  it('lets a reviewer publish the languages of the grant alone', () => {
    const access = accessOf({ admin: false, rights: { languages: ['en'], role: 'reviewer' } }, targets);

    expect(access.mayPublish('en')).toBe(true);
    expect(access.mayPublish('de')).toBe(false);
  });

  /** A grant can name a language the repository does not translate into. */
  it('offers no language the repository does not hold', () => {
    const access = accessOf({ admin: false, rights: { languages: ['pt'], role: 'reviewer' } }, targets);

    expect(access.languages).toEqual([]);
    expect(access.mayPropose('pt')).toBe(false);
  });
});

/** The table stays while the API reads again, so it must not show what a write just made false (DB-241). */
describe('the proposed keys after the writes of this page', () => {
  const waiting = (file: string, key: string, value: string) => ({
    file,
    key,
    value,
    current: null,
    source: 'Texte',
    commit: 'c'.repeat(40),
    readAt: 'd'.repeat(40),
    author: 'Camille',
    at: '2026-10-08T10:00:00Z',
  });
  const read = [waiting('common', 'a', 'old'), waiting('common', 'b', 'kept')];

  it('adds a key that was proposed, and replaces the value of one that waited', () => {
    const after = withWrites(read, {
      over: read,
      proposed: [waiting('common', 'a', 'new'), waiting('common', 'c', 'added')],
      published: new Set(),
    });

    expect(after.map((row) => `${row.key}=${row.value}`).sort()).toEqual(['a=new', 'b=kept', 'c=added']);
  });

  it('drops a key that was published', () => {
    const after = withWrites(read, { over: read, proposed: [], published: new Set(['common\nb']) });

    expect(after.map((row) => row.key)).toEqual(['a']);
  });

  /** The next answer holds the writes. Applied again, they would hide the write of another person. */
  it('leaves a newer answer of the API as it is', () => {
    const newer = [waiting('common', 'a', 'from somebody else')];

    expect(withWrites(newer, { over: read, proposed: [waiting('common', 'a', 'new')], published: new Set() })).toBe(
      newer,
    );
    expect(withWrites(read, null)).toBe(read);
  });

  /** Both happen before the API answers again, or after a reload that failed. */
  it('shows a key that was published and then proposed again as one that waits', () => {
    const published = afterPublication(null, read, ['common\nb']);
    const again = afterProposal(published, read, [waiting('common', 'b', 'second thought')]);

    expect(withWrites(read, published).map((row) => row.key)).toEqual(['a']);
    expect(
      withWrites(read, again)
        .map((row) => `${row.key}=${row.value}`)
        .sort(),
    ).toEqual(['a=old', 'b=second thought']);
  });

  it('drops a key that was proposed and then published', () => {
    const proposed = afterProposal(null, read, [waiting('common', 'c', 'added')]);
    const done = afterPublication(proposed, read, ['common\nc']);

    expect(withWrites(read, done).map((row) => row.key)).toEqual(['a', 'b']);
  });

  it('starts again from nothing over a newer answer', () => {
    const newer = [waiting('common', 'z', 'new')];
    const old = afterProposal(null, read, [waiting('common', 'c', 'added')]);

    expect(afterPublication(old, newer, ['common\nz']).proposed).toEqual([]);
  });
});

describe('a search of the table', () => {
  const row = (key: string, source: string, published: string | null, proposed?: string): Row => ({
    file: 'common',
    key,
    source,
    published,
    proposal: proposed
      ? {
          file: 'common',
          key,
          value: proposed,
          current: published,
          source,
          commit: 'c'.repeat(40),
          readAt: 'd'.repeat(40),
          author: 'Camille',
          at: '2026-10-08T10:00:00Z',
        }
      : null,
    state: proposed ? 'proposed' : published === null ? 'missing' : 'published',
    was: null,
  });
  const rows = [
    row('settings.logout', 'Déconnexion', null),
    row('catalog.page_title', 'Choisissez votre enquête', 'Choose your case'),
    row('timer.paused', 'Chrono en pause', 'Timer paused', 'Clock on hold'),
  ];
  const keys = (query: string) => matching(rows, query).map((found) => found.key);

  it('finds a part of the key, of the source, of the published value and of the proposed one', () => {
    expect(keys('logout')).toEqual(['settings.logout']);
    expect(keys('enquête')).toEqual(['catalog.page_title']);
    expect(keys('your case')).toEqual(['catalog.page_title']);
    expect(keys('on hold')).toEqual(['timer.paused']);
  });

  it('does not count the case or the accents', () => {
    expect(keys('DECONNEXION')).toEqual(['settings.logout']);
    expect(keys('enquete')).toEqual(['catalog.page_title']);
  });

  it('keeps every row for an empty query, and none for a text that is nowhere', () => {
    expect(matching(rows, '   ')).toBe(rows);
    expect(keys('zzz')).toEqual([]);
  });

  it('places a match in the text as it is written, accents and case included', () => {
    expect(matchIn('Choisissez votre enquête', 'ENQUETE')).toEqual([17, 24]);
    expect(matchIn('Déconnexion', 'deco')).toEqual([0, 4]);
    expect(matchIn('Déconnexion', 'zzz')).toBeNull();
    expect(matchIn('Déconnexion', '  ')).toBeNull();
  });

  it('suggests the keys that start with the query first, then the keys that hold it, then the texts', () => {
    const suggested = [
      row('pause.title', 'Titre', null),
      row('timer.paused', 'Chrono en pause', 'Timer paused'),
      row('menu.stop', 'Mettre en pause', null),
    ];

    expect(suggestionsOf(suggested, 'pause').map((found) => found.row.key)).toEqual([
      'pause.title',
      'timer.paused',
      'menu.stop',
    ]);
    expect(suggestionsOf(suggested, '  ')).toEqual([]);
  });

  it('shows under the key the text that holds the query, the translation when the source does not', () => {
    const [found] = suggestionsOf(rows, 'your case');

    expect(found).toMatchObject({ text: 'Choose your case', keyMatch: null, textMatch: [7, 16] });
    expect(suggestionsOf(rows, 'logout')[0]).toMatchObject({ text: 'Déconnexion', keyMatch: [9, 15], textMatch: null });
  });

  it(`stops at ${SUGGESTIONS_SHOWN} suggestions`, () => {
    const many = Array.from({ length: 20 }, (_, index) => row(`list.item_${index}`, 'Objet', null));

    expect(suggestionsOf(many, 'item')).toHaveLength(SUGGESTIONS_SHOWN);
  });
});

describe('the height of a field', () => {
  it('gives one line to a label, and more to a letter of the game', () => {
    expect(linesOf('Déconnexion')).toBe(1);
    expect(linesOf('a'.repeat(120))).toBe(3);
    expect(linesOf('Mon cher Arthur,\nBrûlez cette lettre.')).toBe(2);
  });

  it('stops at eight lines', () => {
    expect(linesOf('a'.repeat(5000))).toBe(8);
  });
});

/** A text typed while the proposal was on its way is not on the branch (DB-239). */
describe('the drafts after a proposal', () => {
  it('drops a draft that still says what was sent, and keeps one that changed since', () => {
    const drafts = new Map([
      ['common\na', 'sent'],
      ['common\nb', 'sent, then typed again'],
      ['common\nc', 'typed during the write'],
    ]);
    const sent = new Map([
      ['common\na', 'sent'],
      ['common\nb', 'sent'],
    ]);

    expect([...draftsAfterProposal(drafts, sent).keys()]).toEqual(['common\nb', 'common\nc']);
  });
});

describe('a page of the table', () => {
  const list = Array.from({ length: 250 }, (_, index) => index + 1);

  it('cuts the list, and says where the page sits', () => {
    expect(pageOf(list, 1, 100)).toMatchObject({ page: 1, pages: 3, from: 1, to: 100, total: 250 });
    expect(pageOf(list, 2, 100).rows[0]).toBe(101);
  });

  it('gives a last page that is not full', () => {
    const last = pageOf(list, 3, 100);

    expect(last).toMatchObject({ page: 3, from: 201, to: 250 });
    expect(last.rows).toHaveLength(50);
  });

  /** A proposal empties the last page. The reader goes back to rows, not to a blank table. */
  it('gives the last page for a page that is past the end', () => {
    expect(pageOf(list.slice(0, 200), 3, 100)).toMatchObject({ page: 2, pages: 2, from: 101, to: 200 });
  });

  it('gives the first page for a page that makes no sense', () => {
    expect(pageOf(list, 0, 100).page).toBe(1);
    expect(pageOf(list, -4, 100).page).toBe(1);
    expect(pageOf(list, Number.NaN, 100).page).toBe(1);
  });

  it('gives one empty page for an empty list', () => {
    expect(pageOf([], 1, 100)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });

  it('holds a list of exactly one page in one page', () => {
    expect(pageOf(list.slice(0, 100), 1, 100)).toMatchObject({ pages: 1, to: 100 });
  });
});

/** The API refuses these keys. The form says why before the request (DB-238). */
describe('a key that cannot be created', () => {
  const existing = new Set(['hello', 'buttons.back', 'buttons.modal.close']);

  it('accepts a key the file does not hold', () => {
    expect(newKeyProblem('buttons.next', existing)).toBeNull();
    expect(newKeyProblem('bye', existing)).toBeNull();
    expect(newKeyProblem('buttons_old.back', existing)).toBeNull();
  });

  it('refuses a key the file holds', () => {
    expect(newKeyProblem('hello', existing)).toMatch(/existe déjà/);
  });

  it('refuses a key that names a section, and one that passes under a text', () => {
    expect(newKeyProblem('buttons', existing)).toMatch(/déjà une section/);
    expect(newKeyProblem('buttons.modal', existing)).toMatch(/déjà une section/);
    expect(newKeyProblem('hello.again', existing)).toMatch(/déjà un texte/);
  });

  it('refuses a key with no name, with a space, with an empty segment or with an unsafe one', () => {
    expect(newKeyProblem('', existing)).toMatch(/Donnez un nom/);
    expect(newKeyProblem('my key', existing)).toMatch(/espace/);
    expect(newKeyProblem('a..b', existing)).toMatch(/point/);
    expect(newKeyProblem('.a', existing)).toMatch(/point/);
    expect(newKeyProblem('a.__proto__.b', existing)).toMatch(/__proto__/);
  });
});

describe('an account that writes the source', () => {
  it('opens every language, and may create a key', () => {
    const access = accessOf({ admin: false, rights: { languages: [], role: 'translator', writesSource: true } }, [
      'en',
      'de',
    ]);

    expect(access.languages).toEqual(['en', 'de']);
    expect(access.mayCreate).toBe(true);
    expect(access.mayPropose('en')).toBe(false);
  });

  it('is not an admin, nor a reviewer of every language', () => {
    expect(accessOf({ admin: true, rights: null }, ['en']).mayCreate).toBe(false);
    expect(accessOf({ admin: false, rights: { languages: ['en'], role: 'reviewer' } }, ['en']).mayCreate).toBe(false);
  });
});

describe('the share that is published', () => {
  it('rounds down, so that a language with a key left never reads 100 %', () => {
    expect(shareOf({ published: 1506, proposed: 23, missing: 142, review: 0 })).toBe(90);
    expect(shareOf({ published: 999, proposed: 0, missing: 1, review: 0 })).toBe(99);
    expect(shareOf({ published: 4, proposed: 0, missing: 0, review: 0 })).toBe(100);
    // A translation to read again is not published: the share says so.
    expect(shareOf({ published: 3, proposed: 0, missing: 0, review: 1 })).toBe(75);
  });

  it('is unknown with no key, and not zero', () => {
    expect(shareOf({ published: 0, proposed: 0, missing: 0, review: 0 })).toBeNull();
  });
});

describe('the page numbers of a pager', () => {
  it('draws every page up to seven', () => {
    expect(pageNumbersOf(1, 2)).toEqual([1, 2]);
    expect(pageNumbersOf(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first, the last, the open page and its neighbours beyond seven', () => {
    expect(pageNumbersOf(1, 17)).toEqual([1, 2, { from: 3, to: 16 }, 17]);
    expect(pageNumbersOf(9, 17)).toEqual([1, { from: 2, to: 7 }, 8, 9, 10, { from: 11, to: 16 }, 17]);
    expect(pageNumbersOf(17, 17)).toEqual([1, { from: 2, to: 15 }, 16, 17]);
  });

  /** Three dots in the place of one number would hide a page and save no room. */
  it('draws a gap of one page as that page', () => {
    expect(pageNumbersOf(3, 17)).toEqual([1, 2, 3, 4, { from: 5, to: 16 }, 17]);
    expect(pageNumbersOf(15, 17)).toEqual([1, { from: 2, to: 13 }, 14, 15, 16, 17]);
  });

  it('never draws more than seven places', () => {
    for (let page = 1; page <= 40; page += 1) expect(pageNumbersOf(page, 40).length).toBeLessThanOrEqual(7);
  });
});

describe('the key that the view of one key shows', () => {
  const list = ['a', 'b', 'c'].map((key) => ({ file: 'common', key }) as Row);

  it('shows the key that was opened, with its place', () => {
    expect(openOf(list, 'common\nb', 0)).toEqual({ row: list[1], index: 1 });
  });

  it('shows the first key when none was opened', () => {
    expect(openOf(list, null, 0)?.index).toBe(0);
  });

  /** A proposal takes the open key out of the missing ones. The next one must take its place. */
  it('shows the key that took the place of one that left the list', () => {
    const left = [list[0], list[2]];

    expect(openOf(left, 'common\nb', 1)).toEqual({ row: list[2], index: 1 });
  });

  it('shows the last key when the one that left was the last', () => {
    expect(openOf([list[0], list[1]], 'common\nc', 2)?.index).toBe(1);
  });

  it('shows nothing for a list that holds nothing', () => {
    expect(openOf([], 'common\nb', 1)).toBeNull();
  });
});

describe('neighboursOf', () => {
  const row = (key: string, state: Row['state'], value: string | null, file = 'common'): Row => ({
    file,
    key,
    source: `fr ${key}`,
    published: state === 'published' ? value : null,
    proposal: state === 'proposed' ? proposal(file, key, value ?? '') : null,
    state,
    was: null,
  });

  const rows: Row[] = [
    row('hints.reveal.confirm', 'missing', null),
    row('hints.title', 'published', 'Hints'),
    row('hints.used', 'published', 'Hint used'),
    row('hints.reveal.cta', 'proposed', 'Reveal the hint'),
    row('hints.empty', 'missing', null),
    row('hintsmore.title', 'published', 'Not a neighbour'),
    row('menu.title', 'published', 'Menu'),
    row('hints.title', 'published', 'Hints', 'admin'),
    row('title', 'published', 'Title'),
    row('subtitle', 'missing', null),
  ];
  const open = { file: 'common', key: 'hints.reveal.confirm' };

  it('keeps the keys of the same file under the first segment, without the open key', () => {
    const { section, total, rows: shown } = neighboursOf(rows, open, new Map());

    expect(section).toBe('hints');
    expect(total).toBe(4);
    // `hintsmore.title` shares the letters, not the segment; `admin` is another file.
    expect(shown.map((entry) => entry.row.key)).toEqual([
      'hints.reveal.cta',
      'hints.title',
      'hints.used',
      'hints.empty',
    ]);
  });

  it('puts the keys with a text first, the missing ones after, with the state the column shows', () => {
    const { rows: shown } = neighboursOf(rows, open, new Map());

    expect(shown.map(({ row: entry, value, state }) => [entry.key, value, state])).toEqual([
      ['hints.reveal.cta', 'Reveal the hint', 'proposed'],
      ['hints.title', 'Hints', 'published'],
      ['hints.used', 'Hint used', 'published'],
      ['hints.empty', null, 'missing'],
    ]);
  });

  it('shows a field typed in this session as the text of the key, and brings a missing key up', () => {
    const drafts = new Map([[idOf(row('hints.empty', 'missing', null)), 'Nothing yet']]);
    const { rows: shown } = neighboursOf(rows, open, drafts);

    expect(shown[0]).toMatchObject({ value: 'Nothing yet', state: 'edited' });
    expect(shown[0].row.key).toBe('hints.empty');
  });

  it('ignores a field that says the same as the key, or nothing', () => {
    const drafts = new Map([
      [idOf(row('hints.title', 'published', 'Hints')), 'Hints'],
      [idOf(row('hints.used', 'published', 'Hint used')), '   '],
    ]);

    expect(neighboursOf(rows, open, drafts).rows.filter((entry) => entry.state === 'edited')).toEqual([]);
  });

  it('shows the other keys without a section for a key without a section', () => {
    const shown = neighboursOf(rows, { file: 'common', key: 'title' }, new Map());

    expect(shown.section).toBe('');
    expect(shown.rows.map((entry) => entry.row.key)).toEqual(['subtitle']);
  });

  it('cuts the list and says how many the section holds', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      row(`hints.k${String(index).padStart(2, '0')}`, 'published', 'x'),
    );
    const shown = neighboursOf([...many, rows[0]], open, new Map(), 8);

    expect(shown.total).toBe(12);
    expect(shown.rows).toHaveLength(8);
  });
});
