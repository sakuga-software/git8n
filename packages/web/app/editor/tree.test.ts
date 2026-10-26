import { describe, expect, it } from 'vitest';
import type { Row } from './rows';
import { treeOf, under } from './tree';

const row = (file: string, key: string, state: Row['state']): Row => ({
  file,
  key,
  source: 'Texte',
  published: state === 'published' ? 'Text' : null,
  proposal: null,
  state,
  was: null,
});

const rows = [
  row('common', 'buttons.back', 'missing'),
  row('common', 'buttons.next', 'published'),
  row('common', 'buttons.modal.close', 'proposed'),
  row('common', 'title', 'published'),
  row('admin', 'analysis.requests_export_hint', 'missing'),
];

describe('the structure of the translations', () => {
  it('makes a node of a file, of each section and of each key', () => {
    const [admin, common] = treeOf(rows);

    expect(admin).toMatchObject({ name: 'admin', path: '', total: 1 });
    expect(common!.children.map((child) => child.name)).toEqual(['buttons', 'title']);
    expect(common!.children[0]!.children.map((child) => `${child.name}:${child.path}`)).toEqual([
      'modal:buttons.modal',
      'back:buttons.back',
      'next:buttons.next',
    ]);
  });

  it('counts under each node the keys it holds, by state', () => {
    const common = treeOf(rows).find((found) => found.name === 'common')!;

    expect(common.counts).toEqual({ missing: 1, review: 0, proposed: 1, published: 2 });
    expect(common.total).toBe(4);
    expect(common.children[0]).toMatchObject({ counts: { missing: 1, proposed: 1, published: 1 }, total: 3 });
  });

  /** The manifest disables a file for a language: it has no key there, and it still exists (DB-225). */
  it('keeps a file that holds no key', () => {
    const guide = treeOf(rows, ['guide']).find((found) => found.name === 'guide');

    expect(guide).toMatchObject({ total: 0, children: [] });
  });

  it('puts the sections before the keys, each by name', () => {
    const [first] = treeOf([row('a', 'z', 'missing'), row('a', 'b.c', 'missing'), row('a', 'a', 'missing')]);

    expect(first!.children.map((child) => child.name)).toEqual(['b', 'a', 'z']);
  });

  /** `buttons` must not take `buttons_old.x` with it. */
  it('gives the rows under a node by whole segments', () => {
    const more = [...rows, row('common', 'buttons_old.back', 'missing'), row('admin', 'buttons.back', 'missing')];

    expect(under(more, { file: 'common', path: 'buttons' }).map((found) => found.key)).toEqual([
      'buttons.back',
      'buttons.next',
      'buttons.modal.close',
    ]);
    expect(under(more, { file: 'common', path: '' })).toHaveLength(5);
    expect(under(more, { file: 'common', path: 'title' }).map((found) => found.key)).toEqual(['title']);
  });
});
